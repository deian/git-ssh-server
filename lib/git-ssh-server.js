var fs         = require('fs');

// version 0.10.x requires util-is for util.isString
if(parseInt(process.version.split('.')[1]) === 10) {
  require('util-is');
}

var util       = require('util');
var crypto     = require('crypto');
var path       = require('path');
var async      = require('async');
var spawn      = require('child_process').spawn;
var debug      = require('debug')('git-ssh-server');
var handlebars = require('handlebars');
var lockFile   = require('lockfile');
var PipeLines  = require('./pipe-lines.js');
var _          = require('underscore');

exports.GitSshServer = GitSshServer;

// config_dir: path to create the git-ssh-server configurations
// options:
// - port: port to listen to (default: 2222)
// - addr: array of address to listen to  (default: '127.0.0.1')
// - user: username of the only user allowed to ssh (default: $USER)
// - keys: array of keys to use (allowed: 'rsa', 'dsa', 'ecdsa')
//   (default: whatever we find in the key directory or all 3 types)
// - sshd: path to sshd (default "/usr/bin/sshd")
// - authFile: path to file that should be used for authorization
// - overwrite: Bool -> overwrite config file (default: true)
function GitSshServer(config_dir, options) {
  if (!this instanceof GitSshServer)
    return new GitSshServer(config_dir, options);

  if (!util.isString(config_dir)) {
    throw new Error("Missing config directory");
  }


  // path relative to / of config_dir
  this.config_dir = '/'+path.relative('/', config_dir);

  if (!options) {
    try {
      if (fs.existsSync(this.config_dir+'/config.json')) {
        options = JSON.parse(fs.readFileSync(this.config_dir+'/config.json'));
        debug("Loaded options from config file");
      }
    } catch(e) {
      debug("Failed to loadoptions config file: "+e);
    };
  }
  if (!options) { options = {}; }

  // port to listen to
  this.port = options.port || 2222;

  // list of addresses to listen on
  this.addr = options.host || '127.0.0.1';
  if (!util.isArray(this.addr)) { this.addr = [this.addr]; }

  // restrict to user or the current user
  this.user = options.user || process.env.USER;

  // keys we want to use
  if (util.isString(options.keys)) { options.keys = [options.keys]; }
  this.keys =  _.filter(options.keys || [], function (k) {
    if(/^(rsa|dsa|ecdsa)$/.test(k)) {
      return true;
    } else {
      throw new Error("Unsupported key type: "+k);
    }
  });

  this.sshd     = options.sshd || "/usr/bin/sshd";
  this.command  = path.normalize(__dirname + "/../bin/git-ssh-server-auth.js");
  this.authFile = options.authFile ? fs.realpathSync(options.authFile)
                                   : this.config_dir+'/authorize.js';

  // Overwrite config file by default
  this.overwrite = !util.isUndefined(options.overwrite) ? !!options.overwrite : true;
}

// synchronous, create directories, find keys, etc.
// calls cb when done
GitSshServer.prototype.config = function (cb) {
  var self = this;

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
  var conf_keys = [];
  _.each(keys, function(k, type) {
    var keyfile = self.config_dir+"/keys/"+type;
    if (k.want) {
      conf_keys.push({ key:  keyfile
                     , type: type
                     , have: k.have });
      if (k.have) {
        debug("Using "+type+" key: "+keyfile);
      }
    }
  });

  // Trun address list into list of objects
  var conf_addr = _.map(self.addr, function(a) { return { addr: a }; });

  async.map(_.filter(conf_keys, function(k) { return !k.have; }), function(key, cb) {
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
      var sshd_template = 
           fs.readFileSync(__dirname+'/../templates/sshd_config').toString();
      var sshd_config =
            handlebars.compile(sshd_template)({ port : self.port
                                              , addr : conf_addr
                                              , keys : conf_keys
                                              , user : self.user
                                              , config_dir : self.config_dir });
      fs.writeFileSync(self.config_dir+'/config', sshd_config);
    } else {
      debug("Using configuration "+self.config_dir+'/config');
    }

    // create auth file if it doesn't exist
    if (!fs.existsSync(self.authFile)) {
      fs.writeFileSync(self.authFile,
                       [ 'module.exports = function (authObject, callback) {'
                       , '  callback("SERVER MISSING AUTHORIZATION FILE");'
                       , '//callback(null, "/path/to/repo/"+authObject.repo);'
                       , '};'].join('\n'), { mode: 0600 });
    }
    // create a symlink from the file that is used in the authorized_keys
    if (fs.existsSync(self.config_dir+"/.authorize.js")) {
      fs.unlinkSync(self.config_dir+"/.authorize.js");
    }
    fs.symlinkSync(self.authFile, self.config_dir+"/.authorize.js");

    var config = { port      : self.port
                 , addr      : self.addr
                 , user      : self.user
                 , keys      : self.keys
                 , sshd      : self.sshd
                 , command   : self.command
                 , authFile  : self.authFile
                 , overwrite : self.overwrite }

    fs.writeFileSync(self.config_dir+'/config.json', JSON.stringify(config, null, " "));

    if (util.isFunction(cb)) cb();

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


GitSshServer.prototype.addUser = function(name, key, cb) {
  // Some sanity checking
  if (!/^\w+$/.test(name)) {
    throw new Error("User name must only contain alphanumeric characters");
  }
  if (!/^[-+a-zA-Z]+$/.test(key.type)) {
    throw new Error("Unsupported key type: "+key.type);
  }
  key.fingerprint =
    crypto.createHash('md5').update(new Buffer(key.key, 'base64')).digest('hex');

  var self = this;
  var lock = self.config_dir+'/run/authorized_keys.lock';
  debug("Adding key for user "+name);
  lockFile.lock(lock, function (err) {
    if (err) return cb(err);
    fs.appendFile(self.config_dir+'/keys/authorized_keys',
                  self.formatKey(name, key), { mode: 0600 }, function (err1) {
      lockFile.unlock(lock, function(err2) {
        if (util.isFunction(cb)) cb(err1 || err2);
      });
    });

  })
};

GitSshServer.prototype.rmUser = function(name, fingerprint, cb) {
  var self = this;
  var lock = self.config_dir+'/run/authorized_keys.lock';
  var authorized_keys = self.config_dir+'/keys/authorized_keys';
  var removed = false;
  
  fingerprint = fingerprint.replace(/:/g,'');

  debug("Removing key " + fingerprint + " for user "+name);

  lockFile.lock(lock, function (err) {
    if (err) return cb(err);

    var unlock = function (err1) {
      lockFile.unlock(lock, function(err2) {
        if (util.isFunction(cb)) 
          cb(err1 || err2 || (removed ? null
                                      : new Error("User key not found")));
      });
    };

    var cleanup = function (err1) {
      fs.unlink(authorized_keys+'.new', function(err2) {
        unlock(err1 || err2);
      });
    };

    var finish = function() {
      async.waterfall([
        function (cb) { // backup old
          debug("Backing up "+authorized_keys);
          fs.link(authorized_keys, authorized_keys+'.bak', cb);
        },
        function (cb) { // remove old
          debug("Removing "+authorized_keys);
          fs.unlink(authorized_keys, cb);
        },
        function (cb) { // rename new
          debug("Using "+authorized_keys+".new as default");
          fs.rename(authorized_keys+'.new', authorized_keys, function (err) {
            if (err) { // rename failed, try rename backup
              debug("Failed, restoring backup");
              fs.rename(authorized_keys+'.bak', authorized_keys, function (fatal) {
                if (fatal) {
                  console.error("FATAL ERROR: could not restore backup authorized_keys. " +
                                "Manual intervention required. Failed with: "+fatal);
                  cb(fatal);
                }
                cb(err); // failed, but authorized_keys is okay
              });
            } else {
              cb(null); // we're in good shape!
            }
          });
        },
        function (cb) {
          debug("Removing backup file");
          fs.unlink(authorized_keys+'.bak', cb);
        },
      ], function (err) {
          if (err) { cleanup(err); } else { unlock(); }
      });
    };

    var plines = new PipeLines(function (line) {
        var key_parts = line.split(' ');
        if (key_parts[key_parts.length-1] === name + '-' + fingerprint) {
          removed = true;
          return false;
        }
        return true;
    });

    var i = fs.createReadStream(authorized_keys);
    var o = fs.createWriteStream(authorized_keys+'.new', { mode:0600 });

    o.on('finish', finish);
    i.on('error', cleanup);
    o.on('error', cleanup);
    i.pipe(plines).pipe(o);
  });

};

GitSshServer.prototype.formatKey = function (name, key) {
  var command = this.command, auth = this.config_dir+"/.authorize.js";
  return 'command="' + [command, auth, name, key.fingerprint].join(' ') + '"' +
         ',no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty '  +
         key.type + ' ' + key.key + ' ' + name + '-' + key.fingerprint + '\n' ;
}
