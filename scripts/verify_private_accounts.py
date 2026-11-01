"""Live synthetic-account API checks plus direct database persistence assertions."""
import secrets
import sys
from pathlib import Path
import httpx
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.database.session import SessionLocal
from app.models.entities import Recipient

base = 'http://127.0.0.1:8000/api/v1'
with httpx.Client(timeout=45) as client:
    def call(method, path, headers=None, expected=200, **kwargs):
        response = client.request(method, base + path, headers=headers, **kwargs)
        assert response.status_code == expected, f'{method} {path}: {response.status_code}'
        print(f'PASS {method} {path}: {response.status_code}', flush=True)
        return response.json()

    owners = []
    for _ in range(2):
        token = call('POST', '/auth/register', expected=201, json={
            'email': f'private-qa-{secrets.token_hex(6)}@example.com',
            'password': secrets.token_urlsafe(24), 'name': 'Private QA', 'organization': 'Private QA',
        })
        owners.append({'Authorization': 'Bearer ' + token['access_token']})
    first, second = owners
    contact = call('POST', '/recipients', first, 201, json={'email': 'private-contact@example.com'})
    identifier = contact['id']
    with SessionLocal() as db:
        assert db.get(Recipient, identifier) is not None
    assert call('GET', '/recipients', second)['total'] == 0
    call('PUT', f'/recipients/{identifier}', second, 404, json={'email': contact['email'], 'name': 'Not allowed'})
    call('DELETE', f'/recipients/{identifier}', second, 404)
    call('POST', '/recipients/bulk-delete', second, 404, json={'recipient_ids': [identifier]})
    call('PUT', f'/recipients/{identifier}', first, json={'email': contact['email'], 'name': 'Persisted change'})
    with SessionLocal() as db:
        assert db.get(Recipient, identifier).name == 'Persisted change'
    # Same email in another private account is legitimate and independent.
    other = call('POST', '/recipients', second, 201, json={'email': contact['email']})
    call('DELETE', f'/recipients/{identifier}', first)
    with SessionLocal() as db:
        assert db.get(Recipient, identifier) is None
        assert db.get(Recipient, other['id']) is not None
    call('POST', '/recipients/bulk-delete', second, json={'recipient_ids': [other['id']]})
    with SessionLocal() as db:
        assert db.get(Recipient, other['id']) is None
    for owner in owners:
        call('POST', '/auth/logout', owner)
    print('PASS: account isolation, persisted create/update, physical single/bulk deletion; synthetic accounts/audits retained.')
