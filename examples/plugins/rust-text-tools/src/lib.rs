//! An example Tabularius plug-in written in Rust. It adds three FileMaker functions:
//!
//!   Ex_Slug ( text )        "Hello, World!"  ->  "hello-world"
//!   Ex_WordCount ( text )   "one two  three" ->  3
//!   Ex_Add ( a ; b )        2 ; 3            ->  5
//!
//! Start from this file for your own plug-in. What Tabularius expects of a WebAssembly plug-in (docs/writing-a-plugin.md):
//!
//!   * The module imports nothing: it can compute, but cannot read files, reach the network or use secrets.
//!   * It exports `memory` (a cdylib does by default), `alloc`, and one function per FileMaker function, named as in
//!     plugin.json.
//!   * `alloc ( length )` gives the address of `length` bytes the host fills with the call's arguments: a JSON array
//!     of text and numbers, like ["Hello, World!"] or [2,3]. Tabularius calls it once at the start of every call.
//!   * Each function takes ( address, length ) of those bytes and returns the address and length of its answer, packed as
//!     address * 2^32 + length. The answer is JSON: a string, a number, true or false, null, or an object.
//!
//! Everything below is plumbing for that, except the three functions at the end.

#![no_std]
extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;

// --- memory ------------------------------------------------------------------------------------------------------
//
// A call is short and its memory is thrown away when it ends, so the simplest allocator is enough: hand out the next
// free bytes of a fixed arena, never free, and start again from the top when `alloc` is called for the next call.

const ARENA: usize = 256 * 1024;

struct Bump {
    arena: UnsafeCell<[u8; ARENA]>,
    next: UnsafeCell<usize>,
}

// The module runs one call at a time on one thread.
unsafe impl Sync for Bump {}

unsafe impl GlobalAlloc for Bump {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let next = &mut *self.next.get();
        let start = (*next + layout.align() - 1) & !(layout.align() - 1);
        if start + layout.size() > ARENA {
            return core::ptr::null_mut(); // out of memory: the call fails and the FileMaker function gives "?"
        }
        *next = start + layout.size();
        (self.arena.get() as *mut u8).add(start)
    }
    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
}

#[global_allocator]
static HEAP: Bump = Bump { arena: UnsafeCell::new([0; ARENA]), next: UnsafeCell::new(0) };

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // A trap: the call fails and the FileMaker function gives "?".
    core::arch::wasm32::unreachable()
}

/// Called by Tabularius at the start of every call: forget the last call's memory and reserve `length` bytes for the
/// arguments. Returns 0 when there is no room.
#[no_mangle]
pub extern "C" fn alloc(length: usize) -> *mut u8 {
    unsafe { *HEAP.next.get() = 0 };
    unsafe { HEAP.alloc(Layout::from_size_align_unchecked(length, 1)) }
}

// --- arguments in, answer out ---------------------------------------------------------------------------------------

enum Arg {
    Text(String),
    Number(f64),
    Other,
}

/// Reads the arguments: a JSON array of strings and numbers (true, false and null are accepted and ignored).
fn arguments(bytes: &[u8]) -> Option<Vec<Arg>> {
    let text = core::str::from_utf8(bytes).ok()?;
    let mut chars = text.char_indices().peekable();
    let mut out = Vec::new();
    let skip = |chars: &mut core::iter::Peekable<core::str::CharIndices>| {
        while matches!(chars.peek(), Some((_, c)) if c.is_whitespace()) {
            chars.next();
        }
    };
    skip(&mut chars);
    if chars.next()?.1 != '[' {
        return None;
    }
    loop {
        skip(&mut chars);
        match chars.peek()?.1 {
            ']' => return Some(out),
            ',' => {
                chars.next();
            }
            '"' => {
                chars.next();
                let mut s = String::new();
                loop {
                    match chars.next()?.1 {
                        '"' => break,
                        '\\' => match chars.next()?.1 {
                            'n' => s.push('\n'),
                            't' => s.push('\t'),
                            'r' => s.push('\r'),
                            'u' => {
                                let mut code = 0u32;
                                for _ in 0..4 {
                                    code = code * 16 + chars.next()?.1.to_digit(16)?;
                                }
                                s.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                            }
                            other => s.push(other), // \" \\ \/
                        },
                        c => s.push(c),
                    }
                }
                out.push(Arg::Text(s));
            }
            _ => {
                let start = chars.peek()?.0;
                let mut end = start;
                while let Some(&(i, c)) = chars.peek() {
                    if c == ',' || c == ']' || c.is_whitespace() {
                        break;
                    }
                    end = i + c.len_utf8();
                    chars.next();
                }
                out.push(match text[start..end].parse::<f64>() {
                    Ok(n) => Arg::Number(n),
                    Err(_) => Arg::Other,
                });
            }
        }
    }
}

/// An answer as JSON, packed for the host: address * 2^32 + length.
fn answer(json: String) -> u64 {
    let json = json.into_bytes().leak(); // the arena is reset by the next call
    ((json.as_ptr() as u64) << 32) | json.len() as u64
}

fn json_text(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&alloc::format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_number(n: f64) -> String {
    if n.is_finite() { alloc::format!("{}", n) } else { String::from("null") }
}

/// The arguments the host put at `ptr`, or None when the call can't be made sense of (the function gives "?").
unsafe fn input(ptr: *const u8, len: usize) -> Option<Vec<Arg>> {
    if ptr.is_null() {
        return None;
    }
    arguments(core::slice::from_raw_parts(ptr, len))
}

// --- the FileMaker functions ------------------------------------------------------------------------------------

/// Ex_Slug ( text ): lower case letters and digits, one "-" between words.
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn Ex_Slug(ptr: *const u8, len: usize) -> u64 {
    let Some(args) = input(ptr, len) else { return 0 };
    let Some(Arg::Text(text)) = args.first() else { return 0 };
    let mut slug = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    if slug.ends_with('-') {
        slug.pop();
    }
    answer(json_text(&slug))
}

/// Ex_WordCount ( text ): the number of words, separated by white space.
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn Ex_WordCount(ptr: *const u8, len: usize) -> u64 {
    let Some(args) = input(ptr, len) else { return 0 };
    let Some(Arg::Text(text)) = args.first() else { return 0 };
    answer(json_number(text.split_whitespace().count() as f64))
}

/// Ex_Add ( a ; b ): the sum of two numbers.
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn Ex_Add(ptr: *const u8, len: usize) -> u64 {
    let Some(args) = input(ptr, len) else { return 0 };
    let (Some(Arg::Number(a)), Some(Arg::Number(b))) = (args.first(), args.get(1)) else { return 0 };
    answer(json_number(a + b))
}
