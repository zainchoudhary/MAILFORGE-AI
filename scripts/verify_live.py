"""Synthetic isolated workspace verification; never approves or sends email."""
import secrets
import time
import httpx

base = 'http://127.0.0.1:8000/api/v1'
with httpx.Client(timeout=45) as client:
    def call(method, path, expected=200, **kwargs):
        start = time.monotonic()
        response = client.request(method, base + path, **kwargs)
        print(f'{method} {path} {response.status_code} {time.monotonic()-start:.2f}s', flush=True)
        assert response.status_code == expected, response.text[:250]
        return response.json()

    account = dict(email=f'qa-{secrets.token_hex(6)}@example.com', password=secrets.token_urlsafe(24),
                   name='Synthetic QA', organization='Isolated live verification')
    auth = call('POST', '/auth/register', 201, json=account)
    client.headers['Authorization'] = 'Bearer ' + auth['access_token']
    for path in ['/auth/me', '/recipients', '/documents', '/campaigns', '/templates', '/emails',
                 '/settings', '/analytics/overview', '/analytics/emails', '/analytics/campaigns',
                 '/audit-logs', '/agents/executions', '/smtp/accounts']:
        call('GET', path)
    doc = call('POST', '/documents/upload', 201, files={'file': ('qa.csv', b'email,name\na@example.com,Alex\nb@example.com,Blair\na@example.com,Alex\n', 'text/csv')})
    call('POST', f'/documents/{doc["id"]}/extract', 202)
    for _ in range(40):
        result = call('GET', f'/documents/{doc["id"]}/recipients')
        if result['status'] in ['completed', 'failed']:
            break
        time.sleep(1)
    assert result['status'] == 'completed', result
    assert len(result['records']) == 2 and result['duplicates'] == 1, result
    recipients = [call('POST', '/recipients', 201, json=r) for r in result['records']]
    call('POST', '/recipients', 409, json=result['records'][0])
    assert call('GET', '/recipients')['total'] == 2
    call('PUT', '/recipients/' + recipients[0]['id'], json={**result['records'][0], 'name': 'Updated QA'})
    template = call('POST', '/templates', 201, json=dict(name='QA template', subject='Hello {{name}}', body='<p>Hello {{name}}</p>'))
    campaign = call('POST', '/campaigns', 201, json=dict(name='QA draft', subject='Hello {{name}}', body='<p>Hello {{name}}</p>', recipient_ids=[r['id'] for r in recipients]))
    path = '/campaigns/' + campaign['id']
    call('GET', path)
    call('GET', path + '/preview')
    call('POST', path + '/review', json={'revision': 1, 'confirm': True})
    dry = call('POST', path + '/dry-run')
    assert dry['sent'] == 0
    call('DELETE', path)
    call('DELETE', '/templates/' + template['id'])
    call('POST', '/recipients/bulk-delete', json={'recipient_ids': [r['id'] for r in recipients]})
    assert call('GET', '/recipients')['total'] == 0
    call('DELETE', '/documents/' + doc['id'])
    call('POST', '/auth/logout')
    call('GET', '/auth/me', 401)
    print('PASS: live extraction, CRUD, duplicate rejection, dry-run, cleanup and logout; no email sent.')
