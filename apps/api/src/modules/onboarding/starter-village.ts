import type { StarterVillageTemplate } from './starter-layout.js';

// Frozen layout designed by Tristan on start@arbestra.world; no gameplay balances or IDs.
export const STARTER_VILLAGE: StarterVillageTemplate = {
  "version": 1,
  "buildings": [
    {
      "type": "dwelling",
      "level": 1,
      "quarterTurns": 3,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "log-house",
        "version": 1,
        "entranceFace": "-z",
        "quarterTurns": 3
      },
      "cells": [
        {
          "x": -2,
          "y": 2,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "dwelling",
      "level": 1,
      "quarterTurns": 3,
      "visualLayout": {
        "offset": [
          0,
          0
        ],
        "recipe": "log-house",
        "version": 1,
        "entranceFace": "-z",
        "quarterTurns": 3
      },
      "cells": [
        {
          "x": -2,
          "y": 1,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "garden",
      "level": 1,
      "quarterTurns": 3,
      "visualLayout": null,
      "cells": [
        {
          "x": -2,
          "y": -1,
          "role": "anchor"
        }
      ]
    },
    {
      "type": "garden",
      "level": 1,
      "quarterTurns": 3,
      "visualLayout": null,
      "cells": [
        {
          "x": -2,
          "y": 0,
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
    "roads": [],
    "inheritedRoads": [],
    "inheritedCells": [],
    "equipment": [],
    "manualLighting": [],
    "suppressedBraziers": []
  }
};
