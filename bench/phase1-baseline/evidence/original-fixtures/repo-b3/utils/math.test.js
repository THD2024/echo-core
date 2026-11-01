const { add, sub } = require('./math');
console.assert(add(2, 3) === 5, 'add(2,3) should be 5');
console.assert(sub(5, 3) === 2, 'sub(5,3) should be 2');
console.log('All tests passed');
