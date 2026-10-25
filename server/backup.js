'use strict';
// Copia consistente do banco (mesmo com o servidor rodando): node server/backup.js
// Gera server/data/backups/rea.db; o cron da VPS empacota esse arquivo + os anexos.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const out = path.join(DATA_DIR, 'backups', 'rea.db');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true }); // VACUUM INTO nao sobrescreve
const db = new DatabaseSync(path.join(DATA_DIR, 'rea.db'));
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`backup ok: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
