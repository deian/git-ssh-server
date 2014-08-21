var fs     = require('fs');
var gitSsh = require('git-ssh-server');

var cmd = process.argv[2];
var usr = process.argv[3];
var key = process.argv[4];

if (process.argv.length < 5 || !/^(add|remove)$/i.test(cmd)) {
  console.error([ "Error: Missing arguments."
                , "Usage: user-mod add <name> <key-file>"
                , "       user-mod remove <name> <key-fingerprint>"].join('\n'));
  return;
}

var ssh = new gitSsh.GitSshServer("myssh_config")

if (/add/i.test(cmd)) {
  fs.readFile(key, function (err, line) {
    if (err) throw err;
    var parts = line.toString().split(' ');
    var key = { type : parts[0]   // algorithm
              , key  : parts[1] }; // actual key
    ssh.addUser(usr, key);
  });
} else {
  ssh.rmUser(usr, key, function(err) { if (err) throw err; });
}
