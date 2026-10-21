# datenorm

Normalizes free-text date mentions to `YYYY-MM-DD`. See `/spec/SPEC.md` for the contract.

```bash
echo '{"id": "1", "text": "July 4, 2023", "locale": "US"}' | python3 -m datenorm
```
