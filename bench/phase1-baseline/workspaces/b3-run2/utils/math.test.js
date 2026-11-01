const { add, sub, multiply } = require('./math');
console.assert(add(2, 3) === 5, 'add(2,3) should be 5');
console.assert(sub(5, 3) === 2, 'sub(5,3) should be 2');
console.assert(multiply(6, 7) === 42, 'multiply(6,7) should be 42');
console.log('All tests passed');
