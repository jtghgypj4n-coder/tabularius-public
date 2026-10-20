// Imported before the server, so the admin console's upload limit is small enough to hit with a small file.
process.env.TABULARIUS_MAX_UPLOAD = String(8 * 1024 * 1024);
