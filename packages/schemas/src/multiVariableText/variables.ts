export type VariableMatch = {
  name: string;
  startIndex: number;
  endIndex: number;
};

export const visitVariables = (
  content: string,
  visitor: (match: VariableMatch) => void,
): void => {
  let startIndex = -1;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '{') {
      // Restart from the latest opener so malformed input never needs backtracking.
      startIndex = i;
      continue;
    }

    if (char === '}' && startIndex !== -1) {
      const name = content.slice(startIndex + 1, i);
      if (name.length > 0) {
        visitor({ name, startIndex, endIndex: i });
      }
      startIndex = -1;
    }
  }
};

export const getVariableIndices = (content: string): Array<string | undefined> => {
  const indices: Array<string | undefined> = [];

  visitVariables(content, ({ name, startIndex }) => {
    indices[startIndex] = name;
  });

  return indices;
};

export const countUniqueVariableNames = (content: string): number => {
  const variableNames = new Set<string>();

  visitVariables(content, ({ name }) => {
    variableNames.add(name);
  });

  return variableNames.size;
};

export const getVariableNames = (content: string): string[] => {
  const variableNames: string[] = [];

  visitVariables(content, ({ name }) => {
    variableNames.push(name);
  });

  return variableNames;
};
