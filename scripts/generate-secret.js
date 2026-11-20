// Prints a random value to use as JWT_SECRET (the key that signs every login).
//   npm run generate-secret
console.log(require('crypto').randomBytes(48).toString('hex'));
