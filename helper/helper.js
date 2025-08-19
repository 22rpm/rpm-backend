// one-time helper snippet
const bcrypt = require('bcrypt');
const plain = 'Passw0rd!';
bcrypt.hash(plain, 12).then(console.log);