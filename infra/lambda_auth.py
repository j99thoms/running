import base64
import hashlib
import hmac
import json
import time

import bcrypt
import boto3

_cache = {}

REGION = 'us-west-2'
CORS_ORIGIN = 'https://running.jakobthoms.ca'


def _ssm(name):
    if name not in _cache:
        ssm = boto3.client('ssm', region_name=REGION)
        _cache[name] = ssm.get_parameter(Name=name, WithDecryption=True)['Parameter']['Value']
    return _cache[name]


def _sign_jwt(sub):
    secret = _ssm('/running/jwt_secret').encode()
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b'=').decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({'sub': sub, 'exp': int(time.time()) + 2592000}).encode()
    ).rstrip(b'=').decode()
    sig = hmac.new(secret, f'{header}.{payload}'.encode(), hashlib.sha256).digest()
    return f'{header}.{payload}.{base64.urlsafe_b64encode(sig).rstrip(b"=").decode()}'


def _resp(status, body, extra_headers=None):
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    }
    if extra_headers:
        headers.update(extra_headers)
    return {'statusCode': status, 'headers': headers, 'body': json.dumps(body)}


def handler(event, context):
    method = event.get('requestContext', {}).get('http', {}).get('method', '')
    path = event.get('rawPath', '')

    if method == 'OPTIONS':
        return _resp(204, '', {'Access-Control-Allow-Methods': 'POST, OPTIONS'})

    if path == '/api/auth/logout' and method == 'POST':
        return _resp(200, {'ok': True}, {
            'Set-Cookie': 'running_auth=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'
        })

    if path == '/api/auth/login' and method == 'POST':
        body = json.loads(event.get('body') or '{}')
        submitted_user = body.get('username', '')
        submitted_pass = body.get('password', '')

        expected_user = _ssm('/running/username')
        pw_hash = _ssm('/running/password_hash').encode()

        if submitted_user == expected_user and bcrypt.checkpw(submitted_pass.encode(), pw_hash):
            token = _sign_jwt(submitted_user)
            cookie = f'running_auth={token}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/'
            return _resp(200, {'ok': True}, {'Set-Cookie': cookie})

        return _resp(401, {'error': 'Invalid credentials'})

    return _resp(404, {'error': 'Not found'})
