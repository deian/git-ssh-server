#!/usr/bin/env node
var fs     = require('fs');
var path   = require('path');
var util   = require('util');
var docopt = require('docopt').docopt;
var pkg    = require('../package.json');
var gitSsh = require('../lib/git-ssh-server.js');

var usage = _toString(function() {/*
Yeah, custom sshd!

Usage:
 $program config <conf> [--port=PORT] [--auth=FILE] [--key=KEY] [--host=HOST]
 $program run <conf> [--daemon]
 $program add-user <conf> <user> <key-file>
 $program rm-user <conf> <user> <key-finger>
 $program -h | --help
 $program -v | --version

Options:
  --port=PORT  Port to listen on                       [default: 2222]
  --host=HOST  Address to listen on                    [default: 0.0.0.0]
  --key=KEY    Key types to generate (rsa, dsa, ecdsa) [default: rsa]
  --auth=FILE  Filepath of authorization module
  --daemon     Run as demon
  -h --help    Show this
  -v --version Get version

Example:
  $program conf mysshd_conf --key dsa
  $program add-user mysshd_conf the-dude ~/.ssh/id_rsa.pub
  $program run mysshd_conf --daemon
*/});

var cli = docopt(usage, { version: require('../package.json').version });

var conf = cli['<conf>'];

if (cli['config']) {
  if (fs.existsSync(conf+"/config.json")) {
    console.error("Already configured, run config first.");
    process.exit(1);
  }
  var ssh = new gitSsh.GitSshServer(conf, 
      { port : cli['--port']
      , host : cli['--host']
      , keys : cli['--key']
      , host : cli['--host']
      , authFile : cli['--auth'] === false ? undefined : cli['--auth']
      , overwrite : false
      });
  ssh.config(function(err) {
    if (err) throw err;
  });
} else {
  if (!fs.existsSync(conf+"/config.json")) {
    console.error("Missing config file, run config first.");
    process.exit(1);
  }

  var ssh = new gitSsh.GitSshServer(conf);

  if(cli['run']) {
    ssh.runServer({detach : cli['--daemon']===true});
  } else if(cli['add-user']) {
    fs.readFile(cli['<key-file>'], function (err, line) {
      if (err) throw err;
      var parts = line.toString().split(' ');
      var key = { type : parts[0], key : parts[1] };
      ssh.addUser(cli['<user>'], key, function(err) {
        if (err) throw err;
      });
    });
  } else if(cli['rm-user']) {
    ssh.rmUser(cli['<user>'], cli['<key-finger>'], function(err) {
      if (err) throw err;
    });
  }
}

function _toString(f) {
  var program = __filename.split("/").slice(-1)[0];
  var lines = f.toString().replace(/\$program/g,program).split('\n');
  return lines.splice(1, lines.length-2).join('\n');
}
