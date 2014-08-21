var gitSsh = require('./lib/git-ssh.js');

if (process.argv.length < 3)
  throw new Error("Missing config directory argument");

var ssh = new gitSsh.GitSshServer(process.argv[2]);
ssh.runServer({detach: false});

