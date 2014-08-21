// Based on Dan Larsen's pipe-lines
// 
// Copyright (c) 2014  Dan Larsen
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

var util = require('util');
var Transform = require('stream').Transform;

module.exports = PipeLines = function (filter, options) {
  if(!(this instanceof PipeLines)) return new PipeLines(options);
  Transform.call(this, options);
  this.lastLine = '';
  this.filter = filter;
};
util.inherits(PipeLines, Transform);

PipeLines.prototype._transform = function(chunk, encoding, done) {
  chunk = this.lastLine + chunk.toString();
  var lines = chunk.split('\n');
  this.lastLine = lines.pop();
  for(var i in lines) {
    if (this.filter(lines[i])) {
      this.push(lines[i]+'\n');
    }
  }
  done();
};

PipeLines.prototype._flush = function(done) {
   if(this.lastLine && this.filter(lastLine)) {
     this.push(this.lastLine+'\n');
   }
   this.lastLine = null;
   done();
};
