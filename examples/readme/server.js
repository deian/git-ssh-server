var gitSsh = require('git-ssh-server');
var ssh = new gitSsh.GitSshServer("myssh_config");
ssh.runServer({detach: false});
