var fs     = require('fs');
var gitSsh = require('../lib/git-ssh-server.js');

if (process.argv.length < 5)
  throw new Error("Missing arguments.\n"+
                  "Usage: rmKey <config> <name> <fingerprint> ");

var ssh = new gitSsh.GitSshServer(process.argv[2]);

ssh.rmUser(process.argv[3], nocol(process.argv[4]), function(err) {
  if (err) throw err;
});

function nocol(str) {
  return str.replace(/:/g,'');
}
