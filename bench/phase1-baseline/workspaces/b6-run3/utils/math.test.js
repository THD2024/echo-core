const { add, sub, multiply, divide } = require('./math');
console.assert(add(2, 3) === 5, 'add(2,3) should be 5');
console.assert(sub(5, 3) === 2, 'sub(5,3) should be 2');
console.assert(multiply(6, 7) === 42, 'multiply(6,7) should be 42');
console.assert(multiply(3, 0) === 0, 'multiply(3,0) should be 0');
console.assert(divide(10, 2) === 5, 'divide(10,2) should be 5');
console.assert(divide(7, 0) === Infinity, 'divide(7,0) should be Infinity');
console.log('All tests passed');
