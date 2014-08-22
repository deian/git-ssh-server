This library makes it easy to implement a custom ssh server (atop sshd) that handles git commands. You only need to implement an authorization module, and voila!

## The short

```shell
$ npm install -g git-ssh-server
$ git-ssh-server config myssh_conf
$ git-ssh-server add-user myssh_conf dude ~/.ssh/id_rsa.pub
... edit myssh_conf/authorize.js (see below) ...
$ git-ssh-server run myssh_conf
```
## Use

```shell
Yeah, custom sshd!

Usage:
 git-ssh-server.js config <conf> [--port=PORT] [--auth=FILE] [--key=KEY] [--host=HOST]
 git-ssh-server.js run <conf> [--daemon]
 git-ssh-server.js add-user <conf> <user> <key-file>
 git-ssh-server.js rm-user <conf> <user> <key-finger>
 git-ssh-server.js -h | --help
 git-ssh-server.js -v | --version

Options:
  --port=PORT  Port to listen on                       [default: 2222]
  --host=HOST  Address to listen on                    [default: 0.0.0.0]
  --key=KEY    Key types to generate (rsa, dsa, ecdsa) [default: rsa]
  --auth=FILE  Filepath of authorization module
  --daemon     Run as demon
  -h --help    Show this
  -v --version Get version

Example:
  git-ssh-server.js conf mysshd_conf --key dsa
  git-ssh-server.js add-user mysshd_conf the-dude ~/.ssh/id_rsa.pub
  git-ssh-server.js run mysshd_conf --daemon
```

## The long: Use as a library

Let's actually do this.

First, let's create a directory for our project:

```shell
$ mkdir myserver
```

And add a `package.json` along the lines of:

```javascript
{
  "name": "myserver",
  "version": "0.0.1",
  "description": "My example ssh server",
  "scripts": {
    "run":"server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "git-ssh-server" : "~0.0.1"
  },
  "author": "John Doe",
  "license": "MIT"
}
```

Great, now `npm install` to install your dependencies. Let's modify our `server.js` file:


```javascript
var gitSsh = require('git-ssh-server');
var ssh = new gitSsh.GitSshServer("myssh_config");
ssh.runServer({detach: false});
```

If you run `npm start` it will now start an ssh server on port 2222.  You can give the `GitSshServer` constructor an options object (described below) that specifies a different port, etc. You'll note that the application also created a directory `myss_config` that contains several scripts and config files:

* `/config.json` : JSON object serving the same role as the options argument
* `/keys` : key directory
* `/keys/authorized_keys` : list of authorized keys, do NOT modify this file manually
* `/run` : directory storing pids and locks
* `/authorize.js` : authorization file, modify accordingly
* `/.authorize.js`: symlink to authorization file; do NOT touch, modify `authFile` in `config.js` instead
* `/config` : generated sshd config file, only modify if overwrite is not tru 

Almost everything should be configured by modifying the `confi.json`
file or passing an options object. The configurable fields are:

* `port`: port to listen to (default: `2222`)
* `addr`: array of stratified address to listen to  (default: '127.0.0.1')
* `user`: username of the only user allowed to "ssh in" (default: `$USER`). In a production environment, you'll want to create a new user and run the server under this user.
* `keys` : array of strings 'rsa', 'dsa', and/or 'ecdsa'. By default we create all these keys or use what's in the keys directory.
* `sshd`: path to sshd (default `/usr/bin/sshd`)
* `authFile`: path to file that should be used for authorization; default file is `authorize.js` in the config directory
* `overwrite`: overwrite config files (default: `true`)

The `runServer` method takes an optional object argument which currently lets you control whether or not sshd should run in the background as a daemon (`detach`).

Tweak these as you see fit, but for now, let's add some users since our ssh server is useless.

## Adding users

To add and remove users you can use the `addUser` and `rmUser` methods of the `GitSshServer` class.
Since user management varies according to applications, you use these in your app as you see fit. One note of warning: you should call `config` at least once (`runServer` does this internally) to generate the config directory etc.

Let's create a CLI utility for adding and removing users from our app. In `user-mod.js`:

```javascript
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
```

Now, you can add and remove users easily:

```shell
$ node user-mod.js add user1 /home/user1/.ssh/id_rsa.pub
$ node user-mod.js add user1 other_key.pub
$ node user-mod.js remove user2 00:11:22:...
```

You'll note that `addUser` takes the username as the first argument and a key objet as the second. The key argument is expected to have a property `type` that describes the algorithm (e.g. `ssh-rsa`) and the `key` property contains the base-64 encoded key value.  Conversely, `rmUser` takes a username and the key fingerprint. This function removes that particular key for this user. While it's safe for you to write code that concurrently uses these function to modify the `authorized_key` file, avoid modifying the `authorized_key file` manually while other code is running.

Okay, now that you have added users to let's try to clone a repo. (Here we're not specifying a username, but this username is common to all users; similar to how github uses the user `git` for everybody.)

```shell
$ git clone ssh://localhost:2222/deian/git-ssh-server.git
Cloning into 'git-ssh-server'...
Insufificient access rights. Failed with: SERVER MISSING AUTHORIZATION FILE
fatal: Could not read from remote repository.

Please make sure you have the correct access rights and the repository exists.
```

So, what's going on? Well we have not provided an authorization file.  Well, really, we just haven't modified the one used by our tool. So let's do that. Modify the `myssh_config/authorize.js` file:

```javascript
module.exports = function (authObject, callback) {
  if (authObject.action == "write" && authObject.user.name !== "admin") {
    callback("Sorry, only reads allowed");
  }
  callback(null, "/tmp/repos/"+authObject.repo);
};
```
This authorization policy allows everybody to clone/pull from repos in `/tmp/repos`, but only allows user named "admin" to push. The function takes an authorization object that contains information about the user (`authObject.user.name` and `authObject.user.fingerprint`), the action type (`authObject.action` which can be "read" or "write"), and repo path (`authObject.repo`) The second argument is the callback that you should call: first argument is an error, second is the actual path to read/write from.

Let's now test this out by adding a repo to `/tmp/repos`:

```shell
$ mkdir -p /tmp/repos/deian
$ git clone --bare git@github.com:deian/git-ssh-server.git /tmp/repos/deian/git-ssh-server.git
```

Now if you do the previous clone, it should work:

```shell
$ git clone ssh://localhost:2222/deian/git-ssh-server.git
```

But if you try to push it will fail:

```shell
$ cd git-ssh-server && git push origin :master
Insufificient access rights. Failed with: Sorry, only reads allowed
fatal: Could not read from remote repository.

Please make sure you have the correct access rights and the repository exists.
```

That's it, modify the authorization fie as you see fit! For example, you may want to do a second authentication pass of the user against a database. This, for instance, let's you revoke keys in your application without modifying the authorized_keys file. To let you do this you can get at the fingerprint of the logged-in user's fingerprint: `authObject.user.fingerprint`.

