# Agent Forge brand

> Describe the specialist you need. Forge it. Put it to work.

Agent Forge makes small, inspectable specialist agents — **Minions** — and proves
what they do. The identity is a workshop, not a chatbot: steel neutrals, one
molten **ember** accent for the moment of making, precise geometry over glow.

## The marks

**The Forge mark** (`forge-mark.svg`) is a shaping **die** with a struck V-notch,
an **ember** landing in the notch, and a **billet** resting inside: making,
shaping, spark, precision. Stroke is `currentColor`, so it takes the surface's
ink; the ember is always ember. `forge-mark-animated.svg` forges itself once —
the die draws, the billet sets, the ember strikes and settles — and is the
product's loading language. The static mark is the reduced-motion fallback.

**The Minion mark** (`minion-mark.svg`) is the same die stamped smaller, carrying
a **status dot** at the shoulder. It shares the Forge's DNA but is clearly a
small worker. The dot color is a variable (`--minion-status`) so one mark serves
every state; an optional inner role glyph differentiates individual Minions. It
holds up at 16–24px. It deliberately avoids the yellow *Despicable Me* character
and generic robot faces.

**The ember is the brand atom**: the strike in the die, the loading pulse, the
smallest favicon. It is always the ember accent and never competes with a second
brand color.

## Color — the Forge system (`tokens.css`)

Cool steel neutrals (the workshop) with a single molten ember (the strike),
light and dark designed together.

| Token | Light | Dark |
| --- | --- | --- |
| Background | `#F3F5F7` | `#0C0E11` |
| Surface | `#FFFFFF` | `#14171B` |
| Ink | `#14181D` | `#E8EAEE` |
| Muted | `#59616D` | `#99A0AB` |
| Line | `#E0E4EA` | `#242A31` |
| Accent (ember) | `#D8451F` | `#FF6A3D` |

**Status is semantic and separate from the accent.** A **declined** run is a
*correct refusal*, not an error, so it is calm blue, never red:

| Status | Meaning | Light |
| --- | --- | --- |
| Shipped | verified fix, tests green | `#12855B` |
| Declined | held back on purpose | `#3E6FA8` |
| Waiting | needs your approval | `#C98A12` |
| Failed | a genuine error | `#C1352B` |
| Running | work in progress | ember |

## Type

- UI: **Inter**
- Code, diffs, receipts: **Geist Mono**

## Rules

- One accent. The ember never shares the stage with a second brand color.
- The mark draws itself at most once per surface, then rests. Respect `prefers-reduced-motion`.
- Never render a success color from a model claim. Green means the backend confirmed it.
- Never set the wordmark in a decorative font it was not drawn in.
