import { describe, it, expect } from 'vitest';
import type { EdgeData } from '../../src/types.js';
import { aggregateEdges } from '../../src/utils/aggregateEdges.js';

const nameMap: Record<string, string> = {
  abraham: 'Abraham',
  sarah: 'Sarah',
  isaac: 'Isaac',
  jacob: 'Jacob',
  esau: 'Esau',
  rebekah: 'Rebekah',
  adam: 'Adam',
  eve: 'Eve',
  seth: 'Seth',
};

function getName(id: string): string {
  return nameMap[id] ?? id;
}

function edge(id: string, sourceId: string, targetId: string, type: string): EdgeData {
  return { id, sourceId, targetId, attributes: { type } };
}

describe('aggregateEdges', () => {
  it('should group incoming edges by label', () => {
    const edges: EdgeData[] = [
      edge('e1', 'abraham', 'isaac', 'father_of'),
      edge('e2', 'sarah', 'isaac', 'mother_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      { father_of: 'Son of', mother_of: 'Son of' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Son of');
    expect(result[0].names).toEqual(['Abraham', 'Sarah']);
    expect(result[0].description).toBe('Son of Abraham and Sarah');
  });

  it('should group outgoing edges by label', () => {
    const edges: EdgeData[] = [
      edge('e1', 'isaac', 'jacob', 'father_of'),
      edge('e2', 'isaac', 'esau', 'father_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      undefined,
      { father_of: 'Father of' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Father of');
    expect(result[0].names).toEqual(['Jacob', 'Esau']);
    expect(result[0].description).toBe('Father of Jacob and Esau');
  });

  it('should handle mixed incoming and outgoing edges', () => {
    const edges: EdgeData[] = [
      edge('e1', 'abraham', 'isaac', 'father_of'),
      edge('e2', 'sarah', 'isaac', 'mother_of'),
      edge('e3', 'isaac', 'jacob', 'father_of'),
      edge('e4', 'isaac', 'esau', 'father_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      { father_of: 'Son of', mother_of: 'Son of' },
      { father_of: 'Father of' },
    );

    expect(result).toHaveLength(2);

    const sonOf = result.find((r) => r.label === 'Son of');
    expect(sonOf).toBeDefined();
    expect(sonOf!.names).toEqual(['Abraham', 'Sarah']);
    expect(sonOf!.description).toBe('Son of Abraham and Sarah');

    const fatherOf = result.find((r) => r.label === 'Father of');
    expect(fatherOf).toBeDefined();
    expect(fatherOf!.names).toEqual(['Jacob', 'Esau']);
    expect(fatherOf!.description).toBe('Father of Jacob and Esau');
  });

  it('should return empty array when no edges match', () => {
    const edges: EdgeData[] = [
      edge('e1', 'abraham', 'isaac', 'father_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      { mother_of: 'Son of' },
    );

    expect(result).toEqual([]);
  });

  it('should skip edge types not in the label map', () => {
    const edges: EdgeData[] = [
      edge('e1', 'abraham', 'isaac', 'father_of'),
      edge('e2', 'sarah', 'isaac', 'mother_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      { father_of: 'Son of' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(['Abraham']);
    expect(result[0].description).toBe('Son of Abraham');
  });

  it('should handle a single edge without "and" joining', () => {
    const edges: EdgeData[] = [
      edge('e1', 'isaac', 'jacob', 'father_of'),
    ];

    const result = aggregateEdges(
      'isaac',
      edges,
      getName,
      undefined,
      { father_of: 'Father of' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].names).toEqual(['Jacob']);
    expect(result[0].description).toBe('Father of Jacob');
  });

  it('dedupes targets when bidirectional edges map to the same label', () => {
    // Bible Graph seed has both directions explicit:
    //   adam → father_of → seth   AND   seth → son_of → adam
    //   eve  → mother_of → seth   AND   seth → son_of → eve
    // A consumer that maps father_of, mother_of (incoming) and son_of (outgoing)
    // all to 'Son of' must not see Adam or Eve duplicated in the bucket.
    const edges: EdgeData[] = [
      edge('e1', 'adam', 'seth', 'father_of'),
      edge('e2', 'seth', 'adam', 'son_of'),
      edge('e3', 'eve', 'seth', 'mother_of'),
      edge('e4', 'seth', 'eve', 'son_of'),
    ];

    const result = aggregateEdges(
      'seth',
      edges,
      getName,
      { father_of: 'Son of', mother_of: 'Son of' },
      { son_of: 'Son of' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Son of');
    expect(result[0].names).toEqual(['Adam', 'Eve']);
    expect(result[0].description).toBe('Son of Adam and Eve');
  });
});
