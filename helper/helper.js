// one-time helper snippet
const bcrypt = require('bcrypt');
const plain = 'Passw0rd!';
bcrypt.hash(plain, 12).then(console.log);

function toMySQLDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " "); // UTC format
}