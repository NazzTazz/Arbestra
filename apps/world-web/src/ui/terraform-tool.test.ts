import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { terrainBrushHeight } from './terraform-draft';
import { CONFIRM_DELAY_MS, CountdownCancelButton, confirmedDeadline } from './PendingDemolition';
import { steppedHeight } from './TerraformPanel';
import { TerraformRefusalDialog } from './TerraformRefusalDialog';
import { oraclePages, serverRefusalReason } from './terraform-refusals';
import { syncV2HttpError } from '../api/sync-v2-session';
import type { VillageState } from '@arbestra/contracts';

describe('Annuler / Confirmer (demolition only since 2 November)', () => {
  it('brings the remaining delay down to 250 ms, never pushes it back', () => {
    expect(CONFIRM_DELAY_MS).toBe(250);
    expect(confirmedDeadline(10_000, 1_000)).toBe(1_250);
    // Less than 250 ms left: the order keeps its earlier deadline.
    expect(confirmedDeadline(1_100, 1_000)).toBe(1_100);
  });

  it('shows the pair while an order waits, nothing otherwise', () => {
    const props = {
      label: 'Annuler la démolition',
      confirmLabel: 'Confirmer la démolition',
      onCancel: () => {},
      onConfirm: () => {},
    };
    const markup = renderToStaticMarkup(
      createElement(CountdownCancelButton, { ...props, deadline: Date.now() + 9_500 }),
    );
    expect(markup).toContain('aria-label="Annuler la démolition"');
    expect(markup).toContain('10 s');
    expect(markup).toContain('aria-label="Confirmer la démolition"');
    expect(markup).toContain('>Confirmer</button>');
    expect(renderToStaticMarkup(createElement(CountdownCancelButton, { ...props, deadline: null }))).toBe('');
  });
});

describe('altitude setting and pipette', () => {
  it('steps by a quarter, as many times as needed, on the server’s quarter grid', () => {
    let height = 1;
    for (let i = 0; i < 40; i++) height = steppedHeight(height, 1);
    expect(height).toBe(11);
    expect(steppedHeight(11, -4)).toBe(10);
    expect(steppedHeight(0.25, -3)).toBe(-0.5);
  });

  it('samples the height at the centre of the clicked cell, rounded to a quarter, on the shown ground', () => {
    const state = { world: { widthCells: 64, heightCells: 64 } } as unknown as VillageState;
    // The shown ground already carries a prediction at (5,5).
    const heightAt = (x: number, y: number) => (x === 5 && y === 5 ? 3 : 2);
    // Cell (5,5)'s corners: (5,5) at 3, the three others at 2; centre on the diagonal (0,0)–(1,1).
    expect(terrainBrushHeight(state, 5, 5, heightAt)).toBe(2.5);
    expect(terrainBrushHeight(state, 10, 10, heightAt)).toBe(2);
  });
});

describe('server refusal of a batch', () => {
  it('reads the refused gesture and the refused units from the JSON body, well-formed ones only', () => {
    const response = new Response(null, { status: 409 });
    const unit = {
      gesture: 0,
      cell: { cellX: 1, cellY: 2 },
      code: 'INFRASTRUCTURE_OCCUPIED',
      at: { cellX: 2, cellY: 2 },
    };
    const named = syncV2HttpError(response, {
      code: 'INFRASTRUCTURE_OCCUPIED',
      message: 'Route.',
      gesture: 2,
      refused: [unit, { gesture: -1, cell: unit.cell, code: 'X', at: unit.at }, { gesture: 1 }, 'nope'],
    });
    expect(named).toMatchObject({ code: 'INFRASTRUCTURE_OCCUPIED', gesture: 2 });
    expect(named.refused).toEqual([unit]);
    expect(serverRefusalReason(named.code)).toBe('road');
    expect(syncV2HttpError(response, { code: 'X', gesture: -1 }).gesture).toBeNull();
    expect(syncV2HttpError(response, { code: 'X', gesture: '1' }).gesture).toBeNull();
    expect(syncV2HttpError(response, { code: 'X' }).refused).toEqual([]);
  });
});

describe('the Oracle’s pages', () => {
  const pages = oraclePages([
    { reason: 'road', cell: { cellX: 3, cellY: 4 } },
    { reason: 'water', cell: null },
  ]);
  it('shows the first error alone, with « 1/2 », Inspecter and Compris, and no grouped line', () => {
    const markup = renderToStaticMarkup(
      createElement(TerraformRefusalDialog, { pages, onInspect: () => {}, onClose: () => {} }),
    );
    expect(markup).toContain('L’Oracle');
    expect(markup).toContain(pages[0]!.text);
    expect(markup).not.toContain('Ailleurs');
    expect(markup).not.toContain(pages[1]!.text);
    expect(markup).toContain('1/2');
    expect(markup).toContain('aria-label="Message suivant"');
    expect(markup).toContain('>Inspecter</button>');
    expect(markup).toContain('>Compris</button>');
  });
  it('has neither pager for a single error nor Inspecter without a cell', () => {
    const markup = renderToStaticMarkup(
      createElement(TerraformRefusalDialog, {
        pages: [{ ...pages[0]!, inspect: null }],
        onInspect: () => {},
        onClose: () => {},
      }),
    );
    expect(markup).not.toContain('Inspecter');
    expect(markup).not.toContain('1/1');
    expect(markup).not.toContain('oracle-pager');
  });
});
