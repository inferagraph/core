import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';

describe('InferaGraph', () => {
  it('should render container element', () => {
    const { container } = render(<InferaGraph />);
    const el = container.querySelector('.ig-container');
    expect(el).toBeTruthy();
  });

  it('should accept className', () => {
    const { container } = render(<InferaGraph className="custom" />);
    const el = container.querySelector('.ig-container.custom');
    expect(el).toBeTruthy();
  });
});
