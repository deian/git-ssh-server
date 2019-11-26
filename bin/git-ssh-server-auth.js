#!/usr/bin/env node
"use strict";
var util  = require('util');
var spawn = require('child_process').spawn;

if (process.argv.length < 5) {
  throw new Error("Usage: git-ssh-server-auth <auth-path-file> <username> <fingerprint>")
}

var authorize   = require(process.argv[2]);
var user        = process.argv[3];
var fingerprint = process.argv[4];

// parse command and repo
var cmd;
try {
  cmd = process.env.SSH_ORIGINAL_COMMAND.split(' ');
} catch (e) {
  console.error("Unsupported command: " + process.env.SSH_ORIGINAL_COMMAND);
  process.exit(1);
}
var command     = cmd[0];
var path        = cmd[1];

// :user/:repo
var path_re     = /^'\/?(\w[\w\+\-\.]*)\/(\w[\w\+\-\.]*)?'$/i;

if (!/^git-(upload|receive)-(pack|archive)$/.test(command) ||
    !path_re.test(path)) {
  console.error("Unsupported command: " + process.env.SSH_ORIGINAL_COMMAND);
  process.exit(1);
}

var repo = path.replace(path_re, '$1/$2');

var authObj = { action : /upload/.test(command) ? "read" : "write"
              , repo   : repo
              , user   : { name : user, key: fingerprint } };

authorize(authObj, function (err, path) {
  if (err) {
    console.error("Insufificient access rights. Failed with: "+err.toString());
    process.exit(1);
  }
  console.error("cmd: "+command+ " " + path);
  var child = spawn(command, authObj.action === "read" ? 
                [path] : ['--stirct', '--timeout=5', path], {detached:true});
  child.on('exit', function(rc) {
    process.exit(rc);
  });
  process.stdin.pipe(child.stdin);
  child.stderr.pipe(process.stderr);
  child.stdout.pipe(process.stdout);
  child.unref();
});
