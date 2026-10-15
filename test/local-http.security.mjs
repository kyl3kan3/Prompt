import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../dist/server/index.js';

test('actual HTTP listener rejects cross-origin approvals before route handling', async () => {
  const server=createServer([]).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const port=server.address().port;
  const call=(path,method,headers={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path,method,headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end();
  });
  try {
    assert.equal(await call('/api/proposals/p1/approve','POST',{'origin':'https://attacker.example','content-type':'application/x-www-form-urlencoded'}),403);
    assert.equal(await call('/api/run/approve','POST'),403);
    assert.equal(await call('/api/inventory','GET',{'host':`attacker.example:${port}`}),403);
    assert.equal(await call('/api/inventory','GET'),200);
    // 409 is the legitimate route's "No run" result, proving same-origin
    // mutations still reach the application after the security check.
    assert.equal(await call('/api/run/approve','POST',{'origin':`http://127.0.0.1:${port}`}),409);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
