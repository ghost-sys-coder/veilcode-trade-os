Manual logging is the source of truth for the initial product.

Every non-obvious trading field must contain descriptive helper text,
a tooltip, or an example in the UI.

The application must distinguish planned values from actual values.

Planned trade values must not be silently overwritten after execution.

Store:
planned entry vs actual entry
planned stop vs actual stop
planned target vs actual exit
planned risk vs actual result
planned R:R vs actual R

The application must support multiple trading accounts.

Accounts must support:
demo
prop challenge
funded
personal live

The schema must be designed so future MT5, MT4, CSV, or broker imports
can populate the same underlying trade models.

A winning trade must not automatically be treated as a good trade.

A losing trade must not automatically be treated as a bad trade.

Execution quality, rule compliance, psychology, and outcome must remain
separate concepts.

Screenshots must support:
before entry
at entry
during trade
at exit
post-trade review

All analytics must show sample size where interpretation could otherwise
be misleading.