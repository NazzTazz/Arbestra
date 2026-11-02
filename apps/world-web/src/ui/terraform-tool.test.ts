import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { terrainBrushHeight } from './terraform-draft';
import { CONFIRM_DELAY_MS, CountdownCancelButton, confirmedDeadline } from './PendingDemolition';
import { plannedHeights, steppedHeight } from './TerraformPanel';
import { TerraformRefusalDialog } from './TerraformRefusalDialog';
import { serverRefusalReason } from './terraform-refusals';
import { syncV2HttpError } from '../api/sync-v2-session';
import type { TerraformVisual } from '../scene/terraform-preview';
import type { VillageState } from '@arbestra/contracts';

describe('Annuler / Confirmer', () => {
  it('brings the remaining delay down to 250 ms, never pushes it back', () => {
    expect(CONFIRM_DELAY_MS).toBe(250);
    expect(confirmedDeadline(10_000, 1_000)).toBe(1_250);
    // Less than 250 ms left: the order keeps its earlier deadline.
    expect(confirmedDeadline(1_100, 1_000)).toBe(1_100);
  });

  it('shows the pair while an order waits, nothing otherwise', () => {
    const props = {
      label: 'Annuler la terraformation',
      confirmLabel: 'Confirmer la terraformation',
      onCancel: () => {},
      onConfirm: () => {},
    };
    const markup = renderToStaticMarkup(
      createElement(CountdownCancelButton, { ...props, deadline: Date.now() + 9_500 }),
    );
    expect(markup).toContain('aria-label="Annuler la terraformation"');
    expect(markup).toContain('10 s');
    expect(markup).toContain('aria-label="Confirmer la terraformation"');
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

  it('samples the height at the centre of the clicked cell, rounded to a quarter, future heights first', () => {
    const state = { world: { widthCells: 64, heightCells: 64 } } as unknown as VillageState;
    const planned = plannedHeights([
      { quote: { vertices: [{ vertexX: 5, vertexY: 5, height: 1 }] } },
      { quote: { vertices: [{ vertexX: 5, vertexY: 5, height: 3 }] } },
    ] as unknown as TerraformVisual[]);
    // The later gesture wins a shared vertex.
    expect(planned.get('5:5')).toBe(3);
    const heightAt = (x: number, y: number) => planned.get(`${x}:${y}`) ?? 2;
    // Cell (5,5)'s corners: (5,5) planned at 3, the three others at 2; centre on the diagonal (0,0)–(1,1).
    expect(terrainBrushHeight(state, 5, 5, heightAt)).toBe(2.5);
    expect(terrainBrushHeight(state, 10, 10, heightAt)).toBe(2);
  });
});

describe('server refusal of a batch', () => {
  it('reads the refused gesture from the JSON body, and only a valid index', () => {
    const response = new Response(null, { status: 409 });
    const named = syncV2HttpError(response, { code: 'INFRASTRUCTURE_OCCUPIED', message: 'Route.', gesture: 2 });
    expect(named).toMatchObject({ code: 'INFRASTRUCTURE_OCCUPIED', gesture: 2 });
    expect(serverRefusalReason(named.code)).toBe('road');
    expect(syncV2HttpError(response, { code: 'X', gesture: -1 }).gesture).toBeNull();
    expect(syncV2HttpError(response, { code: 'X', gesture: '1' }).gesture).toBeNull();
    expect(syncV2HttpError(response, { code: 'X' }).gesture).toBeNull();
  });
});

describe('the Oracle’s refusal', () => {
  const refusal = {
    text: 'Une route sur ce terrain empêche de démarrer les travaux.',
    more: 'Ailleurs dans ce geste, les travaux butent aussi sur un bâtiment.',
    inspect: { cellX: 3, cellY: 4 },
  };
  it('tells the reason with Inspecter and Compris', () => {
    const markup = renderToStaticMarkup(
      createElement(TerraformRefusalDialog, { refusal, onInspect: () => {}, onClose: () => {} }),
    );
    expect(markup).toContain('L’Oracle');
    expect(markup).toContain(refusal.text);
    expect(markup).toContain(refusal.more);
    expect(markup).toContain('>Inspecter</button>');
    expect(markup).toContain('>Compris</button>');
  });
  it('has no Inspecter without a cell', () => {
    const markup = renderToStaticMarkup(
      createElement(TerraformRefusalDialog, {
        refusal: { ...refusal, more: null, inspect: null },
        onInspect: () => {},
        onClose: () => {},
      }),
    );
    expect(markup).not.toContain('Inspecter');
  });
});
