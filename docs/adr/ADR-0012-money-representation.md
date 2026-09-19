# ADR-0012: Money = BIGINT minor units (Rial) + ledger-only wallet
Status: accepted | Owner: Backend Architect
## Why
Contract §35, §170. Reference used PHP float arithmetic for balances (rounding drift) and mutable balance updates without locks.
## Consequences
- wallet_ledger append-only with running balance computed inside the same transaction (SELECT ... FOR UPDATE on tenant wallet row); all amounts BIGINT Rial; no floats anywhere in financial paths.
