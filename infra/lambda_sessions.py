import base64
import hashlib
import hmac
import json
import re
import time
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = 'running-tracker'
USER_ID = 'jakob'
REGION = 'us-west-2'
SESSION_RE = re.compile(r'^w\d+-(mon|wed|sun)$')
CORS_ORIGIN = 'https://running.jakobthoms.ca'

_jwt_secret = None
_table = None


def _get_jwt_secret():
    global _jwt_secret
    if _jwt_secret is None:
        ssm = boto3.client('ssm', region_name=REGION)
        _jwt_secret = ssm.get_parameter(
            Name='/running/jwt_secret', WithDecryption=True
        )['Parameter']['Value'].encode()
    return _jwt_secret


def _get_table():
    global _table
    if _table is None:
        _table = boto3.resource('dynamodb', region_name=REGION).Table(TABLE_NAME)
    return _table


def _verify_jwt(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return False
        sig = base64.urlsafe_b64decode(parts[2] + '==')
        expected = hmac.new(
            _get_jwt_secret(),
            f'{parts[0]}.{parts[1]}'.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(sig, expected):
            return False
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=='))
        return payload.get('exp', 0) > time.time()
    except Exception:
        return False


def _get_token(event):
    # HTTP API payload v2.0 extracts cookies into event['cookies'] (list of "name=value").
    # Payload v1.0 leaves them in headers['cookie'].
    cookie_parts = event.get('cookies') or []
    if not cookie_parts:
        header = (event.get('headers') or {}).get('cookie', '')
        cookie_parts = [p.strip() for p in header.split(';') if p.strip()]
    for part in cookie_parts:
        if part.startswith('running_auth='):
            return part[len('running_auth='):]
    return None


def _resp(status, body=None):
    r = {
        'statusCode': status,
        'headers': {
            'Access-Control-Allow-Origin': CORS_ORIGIN,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin',
        },
    }
    if body is not None:
        r['headers']['Content-Type'] = 'application/json'
        r['body'] = json.dumps(body)
    return r


def handler(event, context):
    token = _get_token(event)
    if not (token and _verify_jwt(token)):
        return _resp(401, {'error': 'Unauthorized'})

    method = event['requestContext']['http']['method']
    path = event['rawPath']

    if path == '/api/sessions' and method == 'GET':
        result = _get_table().query(KeyConditionExpression=Key('userId').eq(USER_ID))
        sessions = {
            item['sessionId']: {
                'completed': bool(item.get('completed', False)),
                'date': item.get('date'),
                'notes': item.get('notes', ''),
            }
            for item in result['Items']
        }
        return _resp(200, {'sessions': sessions})

    m = re.match(r'^/api/sessions/(.+)$', path)
    if m:
        sid = m.group(1)
        if not SESSION_RE.match(sid):
            return _resp(400, {'error': 'Invalid session ID'})

        if method == 'PUT':
            body = json.loads(event.get('body') or '{}')
            _get_table().put_item(Item={
                'userId': USER_ID,
                'sessionId': sid,
                'completed': bool(body.get('completed', False)),
                'date': body.get('date') or None,
                'notes': body.get('notes', ''),
                'updatedAt': datetime.now(timezone.utc).isoformat(),
            })
            return _resp(200, {'sessionId': sid, **body})

        if method == 'DELETE':
            _get_table().delete_item(Key={'userId': USER_ID, 'sessionId': sid})
            return _resp(204)

    return _resp(404, {'error': 'Not found'})
