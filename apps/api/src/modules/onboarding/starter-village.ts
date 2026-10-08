import type { StarterVillageTemplate } from './starter-layout.js';

// Frozen layout designed by Tristan on start@arbestra.world; no gameplay balances or IDs.
export const STARTER_VILLAGE = {
  "version": 1,
  "buildings": [
    {
      "type": "dwelling",
      "level": 1,
      "quarterTurns": 0,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "log-house",
        "version": 1,
        "entranceFace": "-z",
        "quarterTurns": 0
      },
      "cells": [
        {
          "x": -4,
          "y": 0,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "dwelling",
      "level": 1,
      "quarterTurns": 0,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "log-house",
        "version": 1,
        "entranceFace": "-z",
        "quarterTurns": 0
      },
      "cells": [
        {
          "x": -3,
          "y": 0,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "dwelling",
      "level": 1,
      "quarterTurns": 0,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "log-house",
        "version": 1,
        "entranceFace": "-z",
        "quarterTurns": 0
      },
      "cells": [
        {
          "x": -2,
          "y": 0,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "garden",
      "level": 1,
      "quarterTurns": 0,
      "visualLayout": null,
      "cells": [
        {
          "x": -4,
          "y": 2,
          "role": "extension"
        },
        {
          "x": -3,
          "y": 2,
          "role": "extension"
        },
        {
          "x": -2,
          "y": 2,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "town-hall",
      "level": 1,
      "quarterTurns": 0,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "town-hall",
        "version": 1,
        "entranceFace": "+x",
        "quarterTurns": 0
      },
      "cells": [
        {
          "x": 0,
          "y": 0,
          "role": "anchor"
        },
        {
          "x": 0,
          "y": 1,
          "role": "extension"
        }
      ]
    }
  ],
  "infrastructure": {
    "revision": 0,
    "stoneReserve": 0,
    "roads": [
      {
        "id": "road-0",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": -35,
            "y": -8
          },
          {
            "x": 9,
            "y": -8
          },
          {
            "x": 9,
            "y": -7
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-1",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 9,
            "y": -7
          },
          {
            "x": 8,
            "y": -7
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-2",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": -35,
            "y": -8
          },
          {
            "x": 12,
            "y": -8
          },
          {
            "x": 12,
            "y": -7
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-3",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 12,
            "y": -7
          },
          {
            "x": 8,
            "y": -7
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-4",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 8,
            "y": 12
          },
          {
            "x": 17,
            "y": 12
          },
          {
            "x": 17,
            "y": 11
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-5",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 15,
            "y": -16
          },
          {
            "x": 6,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-6",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 6,
            "y": -16
          },
          {
            "x": -8,
            "y": -16
          },
          {
            "x": -8,
            "y": 8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-7",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -9,
            "y": -8
          },
          {
            "x": -42,
            "y": -8
          },
          {
            "x": -42,
            "y": -7
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-8",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 7
          },
          {
            "x": -8,
            "y": 26
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-9",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 26
          },
          {
            "x": -8,
            "y": 8
          },
          {
            "x": -41,
            "y": 8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-10",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": -8
          },
          {
            "x": 34,
            "y": -8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-11",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 34,
            "y": -8
          },
          {
            "x": 46,
            "y": -8
          },
          {
            "x": 46,
            "y": -15
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-12",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 8,
            "y": 18
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-13",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 12,
            "y": -17
          },
          {
            "x": 20,
            "y": -17
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-14",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 20,
            "y": -17
          },
          {
            "x": 19,
            "y": -17
          },
          {
            "x": 19,
            "y": -12
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-15",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 19,
            "y": -12
          },
          {
            "x": 13,
            "y": -12
          },
          {
            "x": 13,
            "y": -14
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-16",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 13,
            "y": -14
          },
          {
            "x": 17,
            "y": -14
          },
          {
            "x": 17,
            "y": -16
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-17",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 17,
            "y": -16
          },
          {
            "x": 12,
            "y": -16
          },
          {
            "x": 12,
            "y": -15
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-18",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 12,
            "y": -15
          },
          {
            "x": 28,
            "y": -15
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-19",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 28,
            "y": -15
          },
          {
            "x": 27,
            "y": -15
          },
          {
            "x": 27,
            "y": -19
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-20",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 27,
            "y": -19
          },
          {
            "x": 35,
            "y": -19
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-21",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 35,
            "y": -19
          },
          {
            "x": 35,
            "y": -14
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-22",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 35,
            "y": -14
          },
          {
            "x": 18,
            "y": -14
          },
          {
            "x": 18,
            "y": -15
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-23",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 18,
            "y": -15
          },
          {
            "x": 33,
            "y": -15
          },
          {
            "x": 33,
            "y": -18
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-24",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 33,
            "y": -18
          },
          {
            "x": 18,
            "y": -18
          },
          {
            "x": 18,
            "y": -17
          }
        ],
        "material": "none",
        "operation": "paint"
      },
      {
        "id": "road-25",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 32,
            "y": -21
          },
          {
            "x": 32,
            "y": -8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-26",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 52,
            "y": -16
          },
          {
            "x": 95,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "road-27",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 4,
            "y": 0
          },
          {
            "x": 28,
            "y": 0
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "road-28",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 28,
            "y": 0
          },
          {
            "x": 24,
            "y": 0
          },
          {
            "x": 24,
            "y": 12
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "road-29",
        "width": 8,
        "border": false,
        "points": [
          {
            "x": 4,
            "y": 8
          },
          {
            "x": 20,
            "y": 8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "road-30",
        "width": 2,
        "border": false,
        "points": [
          {
            "x": 5,
            "y": -4
          },
          {
            "x": 5,
            "y": -3
          }
        ],
        "material": "stone-1",
        "operation": "paint"
      },
      {
        "id": "road-31",
        "width": 2,
        "border": false,
        "points": [
          {
            "x": 5,
            "y": -3
          },
          {
            "x": 28,
            "y": -3
          }
        ],
        "material": "stone-1",
        "operation": "paint"
      },
      {
        "id": "road-32",
        "width": 2,
        "border": false,
        "points": [
          {
            "x": 27,
            "y": -3
          },
          {
            "x": 27,
            "y": 12
          }
        ],
        "material": "stone-1",
        "operation": "paint"
      },
      {
        "id": "road-33",
        "width": 2,
        "border": false,
        "points": [
          {
            "x": 27,
            "y": 11
          },
          {
            "x": 5,
            "y": 11
          }
        ],
        "material": "stone-1",
        "operation": "paint"
      },
      {
        "id": "road-34",
        "width": 2,
        "border": false,
        "points": [
          {
            "x": 6,
            "y": 11
          },
          {
            "x": 5,
            "y": 11
          },
          {
            "x": 5,
            "y": -3
          }
        ],
        "material": "stone-1",
        "operation": "paint"
      }
    ],
    "inheritedRoads": [
      {
        "id": "inherited-0",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": -8
          },
          {
            "x": 8,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-1",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": -8
          },
          {
            "x": 4,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-2",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": -8
          },
          {
            "x": 8,
            "y": -12
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-3",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": -4
          },
          {
            "x": 8,
            "y": -8
          },
          {
            "x": 4,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-4",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 4,
            "y": -8
          },
          {
            "x": 8,
            "y": -8
          },
          {
            "x": 8,
            "y": -12
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-5",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 0,
            "y": -8
          },
          {
            "x": 4,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-6",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 0,
            "y": -8
          },
          {
            "x": -4,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-7",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -8,
            "y": -8
          },
          {
            "x": -4,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-8",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -8,
            "y": -8
          },
          {
            "x": -12,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-9",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -16,
            "y": -8
          },
          {
            "x": -12,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-10",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -16,
            "y": -8
          },
          {
            "x": -20,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-11",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -16,
            "y": -8
          },
          {
            "x": -16,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-12",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -12,
            "y": -8
          },
          {
            "x": -16,
            "y": -8
          },
          {
            "x": -16,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-13",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -20,
            "y": -8
          },
          {
            "x": -16,
            "y": -8
          },
          {
            "x": -16,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-14",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -24,
            "y": -8
          },
          {
            "x": -20,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-15",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -24,
            "y": -8
          },
          {
            "x": -28,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-16",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -24,
            "y": -8
          },
          {
            "x": -24,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-17",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -20,
            "y": -8
          },
          {
            "x": -24,
            "y": -8
          },
          {
            "x": -24,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-18",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -28,
            "y": -8
          },
          {
            "x": -24,
            "y": -8
          },
          {
            "x": -24,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-19",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -32,
            "y": -8
          },
          {
            "x": -28,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-20",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -32,
            "y": -8
          },
          {
            "x": -32,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-21",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -32,
            "y": -8
          },
          {
            "x": -36,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-22",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -28,
            "y": -8
          },
          {
            "x": -32,
            "y": -8
          },
          {
            "x": -32,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-23",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": -32,
            "y": -4
          },
          {
            "x": -32,
            "y": -8
          },
          {
            "x": -36,
            "y": -8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-24",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": 8
          },
          {
            "x": 4,
            "y": 8
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-25",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": 8
          },
          {
            "x": 8,
            "y": 4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-26",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": 8
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-27",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 4,
            "y": 8
          },
          {
            "x": 8,
            "y": 8
          },
          {
            "x": 8,
            "y": 4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-28",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 4,
            "y": 8
          },
          {
            "x": 8,
            "y": 8
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-29",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": 0
          },
          {
            "x": 8,
            "y": 4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-30",
        "width": 3,
        "border": true,
        "points": [
          {
            "x": 8,
            "y": 0
          },
          {
            "x": 8,
            "y": -4
          }
        ],
        "material": "stone-2",
        "operation": "paint"
      },
      {
        "id": "inherited-31",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 8,
            "y": 16
          },
          {
            "x": 8,
            "y": 12
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-32",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 8,
            "y": 16
          },
          {
            "x": 4,
            "y": 16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-33",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 8,
            "y": 12
          },
          {
            "x": 8,
            "y": 16
          },
          {
            "x": 4,
            "y": 16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-34",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 16,
            "y": -16
          },
          {
            "x": 16,
            "y": -12
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-35",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 16,
            "y": -16
          },
          {
            "x": 20,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-36",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 16,
            "y": -12
          },
          {
            "x": 16,
            "y": -16
          },
          {
            "x": 20,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-37",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -40,
            "y": -8
          },
          {
            "x": -36,
            "y": -8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-38",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -40,
            "y": -8
          },
          {
            "x": -44,
            "y": -8
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-39",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 16
          },
          {
            "x": -4,
            "y": 16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-40",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 16
          },
          {
            "x": -8,
            "y": 20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-41",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -4,
            "y": 16
          },
          {
            "x": -8,
            "y": 16
          },
          {
            "x": -8,
            "y": 20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-42",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 24
          },
          {
            "x": -8,
            "y": 20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-43",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": -8,
            "y": 24
          },
          {
            "x": -8,
            "y": 28
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-44",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 48,
            "y": -16
          },
          {
            "x": 44,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-45",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 48,
            "y": -16
          },
          {
            "x": 52,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-46",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 24,
            "y": -16
          },
          {
            "x": 20,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-47",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 24,
            "y": -16
          },
          {
            "x": 28,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-48",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 32,
            "y": -16
          },
          {
            "x": 28,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-49",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 32,
            "y": -16
          },
          {
            "x": 32,
            "y": -20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-50",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 28,
            "y": -16
          },
          {
            "x": 32,
            "y": -16
          },
          {
            "x": 32,
            "y": -20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-51",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 32,
            "y": -24
          },
          {
            "x": 32,
            "y": -20
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-52",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 32,
            "y": -24
          },
          {
            "x": 32,
            "y": -28
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-53",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 56,
            "y": -16
          },
          {
            "x": 52,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-54",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 56,
            "y": -16
          },
          {
            "x": 60,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-55",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 64,
            "y": -16
          },
          {
            "x": 60,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-56",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 64,
            "y": -16
          },
          {
            "x": 68,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-57",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 72,
            "y": -16
          },
          {
            "x": 68,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-58",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 72,
            "y": -16
          },
          {
            "x": 76,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-59",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 80,
            "y": -16
          },
          {
            "x": 76,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-60",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 80,
            "y": -16
          },
          {
            "x": 84,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-61",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 88,
            "y": -16
          },
          {
            "x": 84,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-62",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 88,
            "y": -16
          },
          {
            "x": 92,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-63",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 96,
            "y": -16
          },
          {
            "x": 92,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      },
      {
        "id": "inherited-64",
        "width": 3,
        "border": false,
        "points": [
          {
            "x": 96,
            "y": -16
          },
          {
            "x": 100,
            "y": -16
          }
        ],
        "material": "earth",
        "operation": "paint"
      }
    ],
    "inheritedCells": [
      "-4:-1",
      "-3:-1",
      "-2:-1",
      "-1:-1",
      "0:-1",
      "1:-1",
      "2:-1",
      "1:0",
      "1:1",
      "2:1",
      "1:2",
      "2:2",
      "3:1",
      "3:2",
      "1:-2",
      "2:-2",
      "-1:-2",
      "0:-2",
      "-1:0",
      "-1:1",
      "-5:-1",
      "-1:2",
      "-1:3",
      "-5:1",
      "-4:1",
      "-3:1",
      "-2:1",
      "3:-1",
      "4:-1",
      "5:-1",
      "6:-1",
      "6:-2",
      "3:-2",
      "4:-2",
      "3:-3",
      "4:-3",
      "5:-2",
      "7:-2",
      "8:-2",
      "9:-2",
      "10:-2",
      "11:-2",
      "12:-2",
      "2:0",
      "3:0"
    ],
    "equipment": [
      {
        "x": 28,
        "y": -6,
        "id": "equipment-0",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 30,
        "y": -4,
        "id": "equipment-1",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 30,
        "y": 0,
        "id": "equipment-2",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 30,
        "y": 4,
        "id": "equipment-3",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 30,
        "y": 8,
        "id": "equipment-4",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 30,
        "y": 12,
        "id": "equipment-5",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 24,
        "y": -6,
        "id": "equipment-6",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 3,
        "y": -6,
        "id": "equipment-7",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 28,
        "y": 14,
        "id": "equipment-8",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": 24,
        "y": 14,
        "id": "equipment-9",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": -2,
        "y": -6,
        "id": "equipment-10",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": -6,
        "y": -6,
        "id": "equipment-11",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": -10,
        "y": -6,
        "id": "equipment-12",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": -10,
        "y": -10,
        "id": "equipment-13",
        "version": 1,
        "quarterTurns": 0
      },
      {
        "x": -6,
        "y": -10,
        "id": "equipment-14",
        "version": 1,
        "quarterTurns": 0
      }
    ],
    "manualLighting": [
      "4:-1",
      "4:0",
      "4:1",
      "4:2",
      "3:-1",
      "2:-1",
      "3:2",
      "0:-1",
      "-1:-1"
    ],
    "suppressedBraziers": [
      "auto:3:-1:sub:27:0:-1:-1",
      "auto:4:1:sub:24:0:1:1",
      "auto:4:1:sub:24:11:1:-1",
      "auto:4:1:sub:27:0:1:1",
      "auto:4:2:sub:24:11:1:1",
      "auto:3:2:sub:27:11:-1:1",
      "auto:0:-2:sub:-8:-8:1:-1",
      "auto:3:-3:sub:32:-16:-1:-1",
      "auto:0:-1:sub:8:0:-1:-1",
      "auto:0:-1:sub:5:0:-1:-1",
      "auto:1:-1:sub:9:-7:-1:-1",
      "auto:2:2:sub:24:11:-1:1",
      "auto:2:2:sub:8:11:1:1",
      "auto:0:2:sub:8:8:-1:1",
      "auto:0:2:sub:8:11:-1:1",
      "auto:1:2:sub:5:8:1:1",
      "auto:-5:-1:sub:-42:-8:1:1",
      "auto:-6:-1:sub:-42:-8:-1:1",
      "auto:-2:-2:sub:-8:-8:-1:-1",
      "auto:-2:2:sub:-8:8:-1:1",
      "auto:0:3:sub:-8:16:1:1",
      "auto:5:-2:sub:32:-8:1:-1",
      "auto:5:-2:sub:46:-8:-1:-1"
    ]
  }
} satisfies StarterVillageTemplate;
