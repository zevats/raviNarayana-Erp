const { execSync } = require('child_process');

// Run edge with CDP to evaluate window.innerWidth, clientWidth, card width, etc.
const html = execSync(`powershell -Command "$r = Invoke-WebRequest -Uri 'http://localhost:3001/login'; $r.Content"`).toString();
console.log('HTML fetched, length:', html.length);
