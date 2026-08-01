import { substituteVariables, validateVariables } from '../src/multiVariableText/helper.js';
import { MultiVariableTextSchema } from '../src/multiVariableText/types.js';
import {
  countUniqueVariableNames,
  getVariableIndices,
  getVariableNames,
} from '../src/multiVariableText/variables.js';

describe('substituteVariables', () => {
  it('should substitute variables in a string', () => {
    const text = 'Hello, {name}!';
    const variables = { name: 'World' };
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, World!');
  });

  it('should handle special characters in variable names', () => {
    const text = 'Hello, {*na-me}!';
    const variables = { '*na-me': 'World' };
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, World!');
  });

  it('should handle numeric variable names', () => {
    let text = 'Hello, {123}!';
    let variables = { '123': 'World' };
    let result = substituteVariables(text, variables);
    expect(result).toBe('Hello, World!');
  });

  it('should remove variables that were not substituted', () => {
    const text = 'Hello, {name}! Welcome to {place}.';
    const variables = { name: 'World' };
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, World! Welcome to .');
  });

  it('should handle empty input strings', () => {
    const text = '';
    const variables = { name: 'World' };
    const result = substituteVariables(text, variables);
    expect(result).toBe('');
  });

  it('should handle empty variables', () => {
    const text = 'Hello, {name}!';
    const variables = {};
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, !');
  });

  it('should substitute variables with empty string values', () => {
    const text = 'Hello, {name}!';
    const variables = { name: '' };
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, !');
  });

  it('should handle variables as a JSON string', () => {
    const text = 'Hello, {name}!';
    const variables = '{"name": "World"}';
    const result = substituteVariables(text, variables);
    expect(result).toBe('Hello, World!');
  });

  it('should handle invalid JSON string for variables', () => {
    const text = 'Hello, {name}!';
    const variables = 'invalid json';
    expect(() => substituteVariables(text, variables)).toThrow(SyntaxError);
  });
});

describe('multiVariableText variable scanning', () => {
  it('should record variable start indices for well-formed placeholders', () => {
    const indices = getVariableIndices('{first} {second}');

    expect(indices[0]).toBe('first');
    expect(indices[8]).toBe('second');
  });

  it('should restart from the latest opening brace in malformed input', () => {
    expect(getVariableNames('Hello {{name}}')).toEqual(['name']);
  });

  it('should count only unique completed variable names', () => {
    expect(countUniqueVariableNames('{name} {name} {city')).toBe(1);
  });
});

describe('validateVariables', () => {
  // @ts-ignore
  const schema: MultiVariableTextSchema = {
    name: 'test',
    variables: ['var1', 'var2'],
    required: true,
  };

  it('should return true for valid input with all required variables', () => {
    const value = JSON.stringify({ var1: 'value1', var2: 'value2' });
    expect(validateVariables(value, schema)).toBe(true);
  });

  it('should return true for empty string values with all required variables present', () => {
    const value = JSON.stringify({ var1: '', var2: '' });
    expect(validateVariables(value, schema)).toBe(true);
  });

  it('should throw an error for missing required variables', () => {
    const value = JSON.stringify({ var1: 'value1' });
    expect(() => validateVariables(value, schema)).toThrowError(
      '[@pdfme/generator] variable var2 is missing for field test',
    );
  });

  it('should throw an error for null required variable values', () => {
    const value = JSON.stringify({ var1: null, var2: '' });
    expect(() => validateVariables(value, schema)).toThrowError(
      '[@pdfme/generator] variable var1 is missing for field test',
    );
  });

  it('should return false for missing non-required variables', () => {
    // @ts-ignore
    const nonRequiredSchema: MultiVariableTextSchema = {
      name: 'test',
      variables: ['var1', 'var2'],
      required: false,
    };
    const value = JSON.stringify({ var1: 'value1' });
    expect(validateVariables(value, nonRequiredSchema)).toBe(false);
  });

  it('should return true for empty string values with all non-required variables present', () => {
    // @ts-ignore
    const nonRequiredSchema: MultiVariableTextSchema = {
      name: 'test',
      variables: ['var1', 'var2'],
      required: false,
    };
    const value = JSON.stringify({ var1: '', var2: '' });
    expect(validateVariables(value, nonRequiredSchema)).toBe(true);
  });

  it('should return false for null non-required variable values', () => {
    // @ts-ignore
    const nonRequiredSchema: MultiVariableTextSchema = {
      name: 'test',
      variables: ['var1', 'var2'],
      required: false,
    };
    const value = JSON.stringify({ var1: null, var2: '' });
    expect(validateVariables(value, nonRequiredSchema)).toBe(false);
  });

  it('should throw an error for invalid JSON input', () => {
    const value = '{ var1: value1 var2: value2 }'; // Invalid JSON
    expect(() => validateVariables(value, schema)).toThrowError(SyntaxError);
  });

  it('should return true for a string with no variables', () => {
    // @ts-ignore
    const readOnlyText: MultiVariableTextSchema = {
      name: 'test',
      variables: [],
      required: true,
    };
    const value = '';
    expect(validateVariables(value, readOnlyText)).toBe(true);
  });

  it('should return false for a string with variables but no input JSON and required set to false', () => {
    // @ts-ignore
    const readOnlyText: MultiVariableTextSchema = {
      variables: ['var'],
      required: false,
    };
    const value = '';
    expect(validateVariables(value, readOnlyText)).toBe(false);
  });
});
