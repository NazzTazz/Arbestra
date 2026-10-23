import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Building, ProcessingCommand, ProcessingRecipe } from '@arbestra/contracts';
import { ProcessingPanel } from '../src/ui/ProcessingPanel';
import { WorldContextMenu } from '../src/ui/WorldContextMenu';
import '../src/styles.css';

function Fixture() {
  const [choice, setChoice] = useState('sawmill-1'),
    [command, setCommand] = useState<ProcessingCommand | null>(null);
  const [type, levelString] = choice.split('-'),
    level = Number(levelString),
    stone = type === 'stonemason';
  const building: Building = {
    id: '10000000-0000-4000-8000-000000000001',
    type: stone ? 'stonemason' : 'sawmill',
    level,
    targetLevel: null,
    status: 'completed',
    constructionStartedAt: null,
    constructionCompletesAt: null,
    completedAt: '2026-10-18T00:00:00Z',
    hiddenSuppliesAvailable: false,
    garden: null,
  };
  const recipe: ProcessingRecipe = {
    version: 1,
    inputResource: stone ? 'stone' : 'wood',
    inputAmount: 25,
    outputResource: stone ? 'cut-stone' : 'timber',
    outputAmount: 20,
    workMs: 600000,
    workerCap: stone ? 3 : level,
  };
  return (
    <>
      <label style={{ position: 'fixed', top: 0, right: 0, zIndex: 1000 }}>
        Atelier de recette{' '}
        <select
          aria-label="Atelier de recette"
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value);
            setCommand(null);
          }}
        >
          {['sawmill-1', 'sawmill-2', 'sawmill-3', 'stonemason-1'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <WorldContextMenu anchor={{ x: 8, y: 64 }}>
        <ProcessingPanel
          key={choice}
          slug="production-fixture"
          villageId="10000000-0000-4000-8000-000000000002"
          building={building}
          recipe={recipe}
          orders={[]}
          serverNow={Date.now()}
          revision="0"
          pending={false}
          error={null}
          onCommand={async (value) => {
            setCommand(value);
            return true;
          }}
        />
      </WorldContextMenu>
      <pre
        data-testid="production-command"
        style={{ position: 'fixed', bottom: 0, right: 0, maxWidth: 150, fontSize: 10 }}
      >
        {command ? JSON.stringify(command) : ''}
      </pre>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
