import base64
import hashlib
import hmac
import json
import time

import boto3

_jwt_secret = None

COOKIE_NAME = 'running_auth'
WHITELISTED = ('/login.html', '/api/auth/')
SSM_REGION = 'us-west-2'
SSM_PARAM = '/running/jwt_secret'


def _get_jwt_secret():
    global _jwt_secret
    if _jwt_secret is None:
        ssm = boto3.client('ssm', region_name=SSM_REGION)
        _jwt_secret = ssm.get_parameter(
            Name=SSM_PARAM, WithDecryption=True
        )['Parameter']['Value'].encode()
    return _jwt_secret


def _verify_jwt(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return False
        sig = base64.urlsafe_b64decode(parts[2] + '==')
        expected = hmac.new(_get_jwt_secret(), f'{parts[0]}.{parts[1]}'.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return False
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=='))
        return payload.get('exp', 0) > time.time()
    except Exception:
        return False


def _get_token(cookie_header):
    for part in cookie_header.split(';'):
        part = part.strip()
        if part.startswith(COOKIE_NAME + '='):
            return part[len(COOKIE_NAME) + 1:]
    return None


def handler(event, context):
    request = event['Records'][0]['cf']['request']
    uri = request.get('uri', '/')

    if any(uri.startswith(p) for p in WHITELISTED):
        return request

    cookie_header = ''
    headers = request.get('headers', {})
    if 'cookie' in headers:
        cookie_header = headers['cookie'][0].get('value', '')

    token = _get_token(cookie_header)
    if token and _verify_jwt(token):
        return request

    return {
        'status': '302',
        'statusDescription': 'Found',
        'headers': {
            'location': [{'key': 'Location', 'value': '/login.html'}],
            'cache-control': [{'key': 'Cache-Control', 'value': 'no-store'}],
        },
    }
