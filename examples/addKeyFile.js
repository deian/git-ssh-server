var fs     = require('fs');
var gitSsh = require('../lib/git-ssh-server.js');

if (process.argv.length < 5)
  throw new Error("Missing arguments.\n"+
                  "Usage: addKeyFile <config> <name> <key-file> ");

var ssh = new gitSsh.GitSshServer(process.argv[2]);

fs.readFile(process.argv[4], function (err, line) {
  if (err) throw err;
  var parts = line.toString().split(' ');
  var key = { type : parts[0], key : parts[1] };
  ssh.addUser(process.argv[3], key);
});

