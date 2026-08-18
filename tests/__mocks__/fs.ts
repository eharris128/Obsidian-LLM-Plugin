// Mock Node.js fs module for testing
export const existsSync = jest.fn().mockReturnValue(true);

export const createReadStream = jest.fn().mockReturnValue({
  on: jest.fn((event: string, callback: Function) => {
    if (event === 'data') {
      callback(Buffer.from('test data'));
    } else if (event === 'end') {
      callback();
    }
  }),
});

export const readFileSync = jest.fn().mockReturnValue('test file content');
export const writeFileSync = jest.fn();
export const mkdirSync = jest.fn();

const fs = {
  existsSync,
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
};

export default fs;