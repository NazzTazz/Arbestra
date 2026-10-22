/** Reviewed action closure, not a command interpreter. The branch distinction
 * matters: stopping a future paid lot does not release its team or spend stock. */
export const processingDependencies = {
  'start.lots': {
    reads: ['buildings', 'processingRecipes', 'processingOrders', 'villageResources', 'populationCohorts'],
    temporal: 'shared-inputs-and-workers',
    writes: ['processingOrders', 'processingLots', 'villageResources', 'populationCohorts', 'processingCommandReceipts', 'scheduledTasks'],
  },
  'start.durationSeconds': {
    reads: ['buildings', 'processingRecipes', 'processingOrders', 'villageResources', 'populationCohorts'],
    temporal: 'shared-inputs-and-workers',
    writes: ['processingOrders', 'processingLots', 'villageResources', 'populationCohorts', 'processingCommandReceipts', 'scheduledTasks'],
  },
  resume: {
    reads: ['processingOrders', 'buildings', 'processingRecipes', 'villageResources', 'populationCohorts'],
    temporal: 'shared-inputs-and-workers',
    writes: ['processingOrders', 'processingLots', 'villageResources', 'populationCohorts', 'processingCommandReceipts', 'scheduledTasks'],
  },
  'pause.no-due-lot': {
    reads: ['processingOrders', 'processingLots', 'processingCommandReceipts'],
    temporal: 'target-lot-deadline-only', writes: ['processingOrders', 'processingCommandReceipts'],
  },
  'cancel.no-due-lot': {
    reads: ['processingOrders', 'processingLots', 'processingCommandReceipts'],
    temporal: 'target-lot-deadline-only', writes: ['processingOrders', 'processingCommandReceipts'],
  },
  'pause.due-lot': {
    reads: ['processingOrders', 'processingLots', 'processingRecipes', 'villageResources', 'populationCohorts'],
    temporal: 'shared-inputs-and-workers',
    writes: ['processingOrders', 'processingLots', 'villageResources', 'populationCohorts', 'processingCommandReceipts', 'scheduledTasks'],
  },
  'cancel.due-lot': {
    reads: ['processingOrders', 'processingLots', 'processingRecipes', 'villageResources', 'populationCohorts'],
    temporal: 'shared-inputs-and-workers',
    writes: ['processingOrders', 'processingLots', 'villageResources', 'populationCohorts', 'processingCommandReceipts', 'scheduledTasks'],
  },
  replay: {
    reads: ['processingCommandReceipts'], temporal: 'none', writes: [],
  },
} as const;

// Shared closures retain chronological reconciliation until each producer can
// prove a narrower dependency set. In particular an extraction return can
// release workers, and an earlier processing successor can consume the input.
// Authorization/world membership and village serialization apply to all writes.
