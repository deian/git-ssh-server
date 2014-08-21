var fs         = require('fs');
var util       = require('util');
var path       = require('path');
var async      = require('async');
var spawn      = require('child_process').spawn;
var debug      = require('debug')('git-ssh');
var handlebars = require('handlebars');
var lockFile   = require('lockfile');
var _          = require('underscore');

exports.GitSshServer = GitSshServer;

// config_dir: path to create the git-ssh configurations
// options:
// - port: port to listen to (default: 2222)
// - addr: array of address to listen to  (default: '127.0.0.1')
// - user: username of the only user allowed to ssh (default: $USER)
// - keys: array of keys to use (allowed: 'rsa', 'dsa', 'ecdsa')
//   (default: whatever we find in the key directory or all 3 types)
// - sshd: path to sshd (default "/usr/bin/sshd")
// - overwrite: Bool -> overwrite config file (default: true)
function GitSshServer(config_dir, options) {
  if (!this instanceof GitSshServer)
    return new GitSshServer(config_dir, options);

  if (!util.isString(config_dir)) {
    throw new Error("Missing config directory");
  }

  if (!options) { options = {}; }

  // path relative to / of config_dir
  this.config_dir = '/'+path.relative('/', config_dir);

  // port to listen to
  this.port = options.port || 2222;

  // list of addresses to listen on
  this.addr = options.addr || '127.0.0.1';
  if (!util.isArray(this.addr)) { this.addr = [this.addr]; }
  this.addr = _.map(this.addr, function(a) { return { addr: a }; });

  // restrict to user or the current user
  this.user = options.user || process.env.USER;

  // keys we want to use
  this.keys =  _.filter(options.keys || [], function (k) { 
    if(/^(rsa|dsa|ecdsa)$/.test(k)) {
      return true;
    } else {
      throw new Error("Unsupported key type: "+k);
    }
  });

  this.sshd    = options.sshd || "/usr/bin/sshd";
  this.command = options.command || "echo";


  // Overwrite config file by default
  this.overwrite = options.overwrite ? !!options.overwrite : true;
}

GitSshServer.prototype.config = function (cb) {
  var self = this;

  // Already configured
  if (self.configured) return cb();

  // Create the config directories
  _.each(['','/run','/keys'], function (subdir) {
    if (!fs.existsSync(self.config_dir+subdir)) {
      debug("Creating "+self.config_dir+subdir);
      fs.mkdirSync(self.config_dir+subdir, 0700);
    } else {
      debug("Found "+self.config_dir+subdir);
    }
  });

  var keys = {rsa : {}, dsa: {}, ecdsa : {}};
  // Do we have any keys?
  var files = fs.readdirSync(self.config_dir+'/keys');
  keys.rsa.have   = _.contains(files, 'rsa')   && _.contains(files, 'rsa.pub');
  keys.dsa.have   = _.contains(files, 'dsa')   && _.contains(files, 'dsa.pub');
  keys.ecdsa.have = _.contains(files, 'ecdsa') && _.contains(files, 'ecdsa.pub');
  // Which keys do we want?
  // If we don't have any keys and no keys were specified, we want all
  var haveKey = keys.rsa.have || keys.dsa.have || keys.ecdsa.have;
  if (self.keys.length === 0) {
    if (!haveKey) { // want all keys
      self.keys = ['rsa', 'dsa', 'ecdsa'];
    } else { // want keys that we have
      _.each(keys, function(k, name) {
        if (k.have) self.keys.push(name);
      });
    }
  }
  _.each(self.keys, function(k) { keys[k].want = true; });

  // Update self.keys with the keys we want
  self.keys = [];
  _.each(keys, function(k, type) { 
    var keyfile = self.config_dir+"/keys/"+type;
    if (k.want) { 
      self.keys.push({ key:  keyfile
                     , type: type
                     , have: k.have });
      if (k.have) {
        debug("Using "+type+" key: "+keyfile);
      }
    }
  });

  async.map(_.filter(self.keys, function(k) { return !k.have; }), function(key, cb) {
    debug("Creating "+key.type+" key: "+key.key);
    var child = spawn('ssh-keygen', ['-t', key.type, '-f', key.key], {});
    child.on('exit', function (rc, sig) {
      if (sig) { cb(sig); }
      else if(rc !== 0) { cb(new Error("Non-zero return code: "+rc)); }
      else { cb(); }
    });
  }, function (err) {
    if (err) throw err;

    // Create the config file
    if (!fs.existsSync(self.config_dir+'/config') || self.overwrite) {
      debug("Writing configuration to "+self.config_dir+'/config');
      var sshd_template = fs.readFileSync('./templates/sshd_config').toString();
      var sshd_config =
            handlebars.compile(sshd_template)({ port : self.port
                                              , addr : self.addr
                                              , keys : self.keys
                                              , user : self.user
                                              , config_dir : self.config_dir });
      fs.writeFileSync(self.config_dir+'/config', sshd_config);
    } else {
      debug("Using configuration "+self.config_dir+'/config');
    }

    self.configured = true;

    if (util.isFunction(cb))
      cb();
  });
};

// options:
// - detach: Bool - run as daemon ?
GitSshServer.prototype.runServer = function(options, cb) {
  if (util.isFunction(options)) {
    cb = options;
    options = undefined;
  }
  var self = this;
  self.config(function() {
    debug("Starting server...");
    var args = [], opts = { detach : true };
    if (options && options.detach === false)  {
      args = [ '-De'];
      opts.detach = false;
    }
    var child = spawn(self.sshd, _.flatten(['-f', self.config_dir+'/config', args]), opts);
    if (!opts.detach) {
      process.stdin.pipe(child.stdin);
      child.stderr.pipe(process.stderr);
      child.stdout.pipe(process.stdout);
    }
    if (util.isFunction(cb)) cb();
  });
};

GitSshServer.prototype.lockFile = function() {
  return this.config_dir+'/run/authorized_keys.lock';
};

GitSshServer.prototype.addUser = function(name, key, cb) {
  // Some sanity checking
  if (!/^\w+$/.test(name)) {
    throw new Error("User name must only contain alphanumeric characters");
  }
  if (!/^[-+a-zA-Z]+$/.test(key.type)) {
    throw new Error("Unsupported key type: "+key.type);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(key.key)) {
    throw new Error("Invalid key value, expectd base64-encoded string");
  }

  var self = this;
  self.config(function() {
    debug("Adding key for user "+name);
    lockFile.lockSync(self.lockFile());
    fs.appendFileSync(self.config_dir+'/keys/authorized_keys',
                     formatUser(self.command, name, key), { mode: 0600 } );
    lockFile.unlockSync(self.lockFile());

    if (util.isFunction(cb)) cb();
  });
};

function formatUser(command, name, key) {
  return 'command="'+command+' '+name+'",no-port-forwarding,' +
         'no-X11-forwarding,no-agent-forwarding,no-pty '+
         key.type+' '+key.key+' '+name+'\n';
}
