export function validPrivilegeSetName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 256 &&
    Buffer.from(name, 'utf8').toString('utf8') === name && name.trim() === name &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(name) && !/^[=+\-@]/u.test(name);
}

export function validAccountImportName(name: string): boolean {
  return name.length > 0 && name.length <= 256 && Buffer.from(name, 'utf8').toString('utf8') === name &&
    name.trim() === name && !/[\u0000-\u001f\u007f-\u009f]/u.test(name) && !/^[=+\-@]/u.test(name);
}
