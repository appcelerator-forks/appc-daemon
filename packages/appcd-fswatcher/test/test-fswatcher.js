import appcdLogger from 'appcd-logger';
import fs from 'fs-extra';
import path from 'path';
import tmp from 'tmp';

import { real } from 'appcd-path';

import {
	FSWatcher,
	roots,
	register,
	unregister,
	reset,
	renderTree,
	status
} from '../dist/index';

const logger = appcdLogger('test:appcd:fswatcher');
const { log } = logger;
const { green, highlight } = appcdLogger.styles;

const _tmpDir = tmp.dirSync({
	prefix: 'appcd-fswatcher-test-',
	unsafeCleanup: true
}).name;
const tmpDir = real(_tmpDir);

function makeTempName() {
	return path.join(_tmpDir, Math.random().toString(36).substring(7));
}

function makeTempDir() {
	const dir = makeTempName();
	fs.mkdirsSync(dir);
	return dir;
}

describe('FSWatcher', () => {
	after(() => {
		fs.removeSync(tmpDir);
	});

	describe('constructor', () => {
		it('should throw error if path is not a string', () => {
			expect(() => {
				new FSWatcher();
			}).to.throw(TypeError, 'Expected path to be a string');

			expect(() => {
				new FSWatcher(123);
			}).to.throw(TypeError, 'Expected path to be a string');

			expect(() => {
				new FSWatcher(function () {});
			}).to.throw(TypeError, 'Expected path to be a string');
		});

		it('should throw error if options is not an object', () => {
			expect(() => {
				new FSWatcher('foo', 'bar');
			}).to.throw(TypeError, 'Expected options to be an object');

			expect(() => {
				new FSWatcher('foo', 123);
			}).to.throw(TypeError, 'Expected options to be an object');
		});

		it('should throw error if recursion depth is invalid', () => {
			expect(() => {
				new FSWatcher('foo', {
					recursive: true,
					depth: 'foo'
				});
			}).to.throw(TypeError, 'Expected recursion depth to be a number');

			expect(() => {
				new FSWatcher('foo', {
					recursive: true,
					depth: NaN
				});
			}).to.throw(TypeError, 'Expected recursion depth to be a number');

			expect(() => {
				new FSWatcher('foo', {
					recursive: true,
					depth: -1
				});
			}).to.throw(TypeError, 'Recursion depth must be greater than or equal to zero');
		});
	});

	describe('watching', () => {
		beforeEach(done => {
			const stats = status();
			try {
				expect(stats.nodes).to.equal(0);
				expect(stats.fswatchers).to.equal(0);
				expect(stats.watchers).to.equal(0);
				done();
			} catch (e) {
				console.log(stats);
				done(e);
			}
		});

		afterEach(function (done) {
			this.timeout(10000);
			reset();
			log(renderTree());
			if (logger.enabled) {
				console.log('\n**********************************************************************************\n');
			}
			setTimeout(() => done(), 1000);
		});

		describe('directories', () => {
			it('should watch an existing directory for a new file', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');

				setTimeout(() => {
					new FSWatcher(tmp, null)
						.on('change', evt => {
							expect(evt).to.be.an('object');
							if (evt.file.indexOf(tmpDir) === 0) {
								expect(evt.action).to.equal('add');
								expect(evt.file).to.equal(real(filename));

								const stats = status();
								expect(stats.nodes).to.be.above(0);
								expect(stats.fswatchers).to.be.above(0);
								expect(stats.watchers).to.equal(1);

								done();
							}
						})
						.on('error', done);

					log(renderTree());
					log('Writing %s', highlight(filename));
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should close and re-open watcher', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				setTimeout(() => {
					const watcher = new FSWatcher(tmp)
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(filename));

										const stats = status();
										expect(stats.nodes).to.be.above(0);
										expect(stats.fswatchers).to.be.above(0);
										expect(stats.watchers).to.equal(1);

										log('Closing watcher');
										expect(watcher.close()).to.be.true;

										setTimeout(() => {
											const stats = status();
											expect(stats.nodes).to.equal(0);
											expect(stats.fswatchers).to.equal(0);
											expect(stats.watchers).to.equal(0);

											log('Opening watcher');
											watcher.open();

											setTimeout(() => {
												log('Appending to %s', highlight(filename));
												fs.appendFileSync(filename, '\nbar!');
											}, 1000);
										}, 1000);
										break;

									case 2:
										expect(evt.action).to.equal('change');
										expect(evt.file).to.equal(real(filename));

										expect(() => {
											log('Re-opening watcher');
											watcher.open();
										}).to.throw(Error, 'Already open');

										done();
								}
							}
						})
						.on('error', done);

					log('Writing %s', highlight(filename));
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should watch an existing directing for a new file that is changed', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				setTimeout(() => {
					new FSWatcher(tmp)
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								counter++;
								if (counter === 1) {
									// adding the file
									expect(evt.action).to.equal('add');
									expect(evt.file).to.equal(real(filename));
									log(renderTree());
								} else if (counter === 2) {
									// updating the file
									expect(evt.action).to.equal('change');
									expect(evt.file).to.equal(real(filename));
									done();
								}
							}
						})
						.on('error', done);

					fs.writeFileSync(filename, 'foo!');

					setTimeout(() => {
						fs.appendFileSync(filename, '\nbar!');
					}, 100);
				}, 100);
			});

			it('should watch a directory that does not exist', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempName();
				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				log(`Temp dir = ${tmp}`);

				new FSWatcher(tmp)
					.on('change', evt => {
						if (evt.file.indexOf(tmpDir) === 0) {
							log('Change Event: %s %s (counter=%s)', green(`[${evt.action}]`), highlight(evt.file), counter);

							expect(evt.action).to.equal('add');
							if (counter++ === 0) {
								expect(evt.file).to.equal(real(tmp));
							} else {
								expect(evt.file).to.equal(real(filename));
								done();
							}
						}
					})
					.on('error', done);

				setTimeout(() => {
					log('Creating %s', highlight(tmp));
					fs.mkdirsSync(tmp);

					setTimeout(() => {
						log(renderTree());
						log('Writing %s', highlight(filename));
						fs.writeFileSync(filename, 'foo!');
					}, 100);
				}, 100);
			});

			it('should unwatch a directory', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));
				const filename = path.join(tmp, 'foo.txt');
				const filename2 = path.join(tmp, 'bar.txt');
				let counter = 0;

				const watcher = new FSWatcher(tmp)
					.on('change', evt => {
						if (evt.file.indexOf(tmpDir) === 0) {
							if (counter === 1) {
								log('Got event!');
								expect(evt.action).to.equal('add');
								expect(evt.file).to.equal(real(filename));

								log('Closing watcher');
								watcher.close();
								log(renderTree());

								setTimeout(() => {
									log('Writing second file: %s', highlight(filename2));
									fs.writeFileSync(filename2, 'bar!');
									setTimeout(() => {
										expect(roots).to.deep.equal({});
										done();
									}, 1000);
								}, 100);
								counter++;
							} else if (counter === 2) {
								done(new Error('Expected onChange to only fire once'));
							}
						}
					})
					.on('error', done);

				setTimeout(() => {
					counter++;
					log('Writing %s', highlight(filename));
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should watch a directory that is deleted and recreated', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempName();
				const fooDir = path.join(tmp, 'foo');
				const barFile = path.join(fooDir, 'bar.txt');
				let counter = 0;

				log('Creating temp foo directory: %s', highlight(fooDir));
				fs.mkdirsSync(fooDir);

				setTimeout(() => {
					new FSWatcher(fooDir)
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								log('Change Event: %s %s (counter=%s)', green(`[${evt.action}]`), highlight(evt.file), counter);

								if (evt.action === 'add') {
									counter++;
									if (counter === 1) {
										expect(evt.file).to.equal(real(barFile));
										log(renderTree());
										log('Deleting temp directory: %s', highlight(tmp));
										fs.removeSync(tmp);
									} else if (counter === 2) {
										expect(evt.file).to.equal(real(barFile));
										log(renderTree());
										done();
									}
								} else if (evt.action === 'delete') {
									expect(evt.file).to.equal(real(barFile));

									setTimeout(() => {
										log(renderTree());
										log('Creating temp foo directory: %s', highlight(fooDir));
										fs.mkdirsSync(fooDir);

										log('Writing %s', highlight(barFile));
										fs.writeFileSync(barFile, 'bar again!');
									}, 1000);
								}
							}
						})
						.on('error', done);

					fs.writeFileSync(barFile, 'bar!');
				}, 100);
			});

			it('should have two watchers watching the same directory and unwatch them', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				const watcher1 = new FSWatcher(tmp)
					.on('change', evt => {
						if (evt.file === real(filename)) {
							expect(evt.action).to.equal('add');
							unwatch();
						}
					})
					.on('error', done);

				const watcher2 = new FSWatcher(tmp)
					.on('change', evt => {
						if (evt.file === real(filename)) {
							expect(evt.action).to.equal('add');
							unwatch();
						}
					})
					.on('error', done);

				function unwatch() {
					if (++counter === 2) {
						log(renderTree());
						expect(roots).to.not.deep.equal({});
						log('Closing watcher 1');
						watcher1.close();

						setTimeout(() => {
							try {
								log(renderTree());
								expect(roots).to.not.deep.equal({});
								log('Closing watcher 2');
								watcher2.close();

								setTimeout(() => {
									try {
										log(renderTree());
										expect(roots).to.deep.equal({});
										done();
									} catch (e) {
										done(e);
									}
								}, 1000);
							} catch (e) {
								done(e);
							}
						}, 1000);
					}
				}

				setTimeout(() => {
					log('Writing %s', highlight(filename));
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should close and re-watch a directory', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const filename = path.join(tmp, 'foo.txt');

				const watcher = new FSWatcher(tmp)
					.on('change', evt => {
						if (evt.file === real(filename)) {
							done(new Error('First watcher was invoked'));
						}
					})
					.on('error', done);

				setTimeout(() => {
					try {
						watcher.close();

						expect(roots).to.deep.equal({});

						new FSWatcher(tmp)
							.on('change', evt => {
								if (evt.file.indexOf(tmpDir) === 0) {
									expect(evt.action).to.equal('add');
									expect(evt.file).to.equal(real(filename));
									done();
								}
							})
							.on('error', done);

						log('Writing %s', highlight(filename));
						fs.writeFileSync(filename, 'foo!');
					} catch (e) {
						done(e);
					}
				}, 100);
			});
		});

		describe('files', () => {
			it('should watch an existing file for a change', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');
				fs.writeFileSync(filename, 'foo!');

				new FSWatcher(filename)
					.on('change', evt => {
						if (evt.file.indexOf(tmpDir) === 0) {
							expect(evt.action).to.equal('change');
							expect(evt.file).to.equal(real(filename));
							done();
						}
					})
					.on('error', done);

				log(renderTree());

				setTimeout(() => {
					log(`Appending to ${filename}`);
					fs.appendFileSync(filename, '\nbar!');
				}, 100);
			});

			it('should watch a file that does not exist', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				new FSWatcher(tmp)
					.on('change', evt => {
						if (counter && evt.file.indexOf(tmpDir) === 0) {
							try {
								expect(evt.action).to.equal('add');
								expect(evt.file).to.equal(real(filename));
								done();
							} catch (e) {
								done(e);
							}
						}
					})
					.on('error', done);

				setTimeout(() => {
					counter++;
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should unwatch a file', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));
				const filename = path.join(tmp, 'foo.txt');
				let counter = 0;

				const watcher = new FSWatcher(tmp)
					.on('change', evt => {
						// console.log(counter, evt);

						if (counter && evt.file.indexOf(tmpDir) === 0) {
							if (counter === 1) {
								expect(evt.action).to.equal('add');
								expect(evt.file).to.equal(real(filename));
								setTimeout(() => {
									fs.appendFileSync(filename, '\nbar!');
								}, 100);
							} else if (counter === 2) {
								expect(evt.action).to.equal('change');
								expect(evt.file).to.equal(real(filename));

								log('Closing watcher');
								watcher.close();
								log(renderTree());

								setTimeout(() => {
									fs.appendFileSync(filename, '\nbaz!');
									setTimeout(() => {
										try {
											expect(roots).to.deep.equal({});
											done();
										} catch (e) {
											done(e);
										}
									}, 1000);
								}, 100);
							} else {
								done(new Error('Expected onChange to only fire once'));
							}
							counter++;
						}
					})
					.on('error', done);

				setTimeout(() => {
					counter++;
					log('Writing %s', highlight(filename));
					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should watch a file that is deleted and recreated', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const filename = path.join(tmp, 'foo.txt');
				log('Writing %s', highlight(filename));
				fs.writeFileSync(filename, 'foo!');

				let counter = 0;

				setTimeout(() => {
					new FSWatcher(filename)
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								counter++;

								if (counter === 1) {
									expect(evt.action).to.equal('change');
									expect(evt.file).to.equal(real(filename));

									fs.unlinkSync(filename);

								} else if (counter === 2) {
									expect(evt.action).to.equal('delete');
									expect(evt.file).to.equal(real(filename));

									setTimeout(() => {
										fs.writeFileSync(filename, 'bar again!');
									}, 100);

								} else if (counter === 3) {
									expect(evt.action).to.equal('add');
									expect(evt.file).to.equal(real(filename));
									done();
								}
							}
						})
						.on('error', done);

					log('Appending to %s', highlight(filename));
					fs.appendFileSync(filename, '\nbar!');
				}, 100);
			});
		});

		describe('recursive', () => {
			it('should recursively watch for changes in existing nested directories', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				log('Creating foo directory: %s', highlight(fooDir));
				fs.mkdirSync(fooDir);

				const barDir = path.join(fooDir, 'bar');
				const filename = path.join(barDir, 'baz.txt');
				let counter = 0;

				setTimeout(() => {
					new FSWatcher(tmp, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(barDir));

										log('Writing %s', highlight(filename));
										fs.writeFileSync(filename, 'foo!');
										break;

									case 2:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(filename));

										log('Deleting %s', highlight(barDir));
										fs.removeSync(barDir);
										break;

									case 3:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(real(filename));
										break;

									case 4:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(real(barDir));
										done();
										break;
								}
							}
						})
						.on('error', done);

					log(renderTree());
					log('Creating bar directory: %s', highlight(barDir));
					fs.mkdirsSync(barDir);
				}, 100);
			});

			it('should recursively watch for changes in new nested directories', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				const barDir = path.join(fooDir, 'bar');
				const filename = path.join(barDir, 'baz.txt');
				let counter = 0;

				setTimeout(() => {
					new FSWatcher(tmp, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(fooDir));

										log('Creating directory: %s', highlight(barDir));
										fs.mkdirSync(barDir);
										break;

									case 2:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(barDir));

										log('Writing %s', highlight(filename));
										fs.writeFileSync(filename, 'foo!');
										break;

									case 3:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(real(filename));

										log('Deleting %s', highlight(barDir));
										fs.removeSync(barDir);
										break;

									case 4:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(real(filename));
										break;

									case 5:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(real(barDir));
										done();
										break;
								}
							}
						})
						.on('error', done);

					log(renderTree());
					log('Creating foo directory: %s', highlight(fooDir));
					fs.mkdirsSync(fooDir);
				}, 100);
			});

			it('should fire an event for two watcher down same path', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const barDir = path.join(tmp, 'foo', 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				let counter = 0;
				const bazFile = path.join(barDir, 'baz.txt');

				setTimeout(() => {
					function check() {
						if (++counter === 3) {
							done();
						}
					}

					const watcher1 = new FSWatcher(tmp, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								check();
								setTimeout(() => {
									fs.appendFileSync(bazFile, 'more baz!');
								}, 1000);
							}
						})
						.on('error', done);

					const watcher2 = new FSWatcher(barDir)
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								log('Closing watcher 2');
								watcher2.close();
								log(renderTree());
								check();
							}
						})
						.on('error', done);

					log(renderTree());
					log('Writing %s', highlight(bazFile));
					fs.writeFileSync(bazFile, 'baz!');
				}, 100);
			});

			it('should unwatch recursive directory watcher', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const barDir = path.join(tmp, 'foo', 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				const filename = path.join(barDir, 'baz.txt');
				log('Writing %s', highlight(filename));
				fs.writeFileSync(filename, 'baz!');

				setTimeout(() => {
					const watcher = new FSWatcher(tmp, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								expect(evt.action).to.equal('change');
								expect(evt.file).to.equal(real(filename));
								watcher.close();
								expect(roots).to.deep.equal({});
								done();
							}
						})
						.on('error', done);

					log(renderTree());
					log('Appending to %s', highlight(filename));
					fs.appendFileSync(filename, 'more baz!');
				}, 100);
			});

			it('should throw error if trying to recursively watch root', () => {
				expect(() => {
					new FSWatcher('/', { recursive: true });
				}).to.throw(Error, 'Recursively watching root is not permitted');
			});

			// it('should only recursively watch 2 directories deep', function (done) {
			// 	this.timeout(10000);
			// 	this.slow(8000);
			//
			// 	const tmp = makeTempDir();
			// 	log('Creating temp directory: %s', highlight(tmp));
			//
			// 	const wizDir = path.join(tmp, 'foo', 'bar', 'baz', 'wiz');
			// 	log('Creating wiz directory: %s', highlight(wizDir));
			// 	fs.mkdirsSync(wizDir);
			//
			// 	const files = [
			// 		path.join(tmp, 'test.txt'),
			// 		path.join(tmp, 'foo', 'foo-test.txt'),
			// 		path.join(tmp, 'foo', 'bar', 'bar-test.txt'),
			// 		path.join(tmp, 'foo', 'bar', 'baz', 'baz-test.txt'),
			// 		path.join(tmp, 'foo', 'bar', 'baz', 'wiz', 'wiz-test.txt')
			// 	];
			// 	let index = 0;
			// 	let lastEvt;
			// 	let timer;
			//
			// 	setTimeout(() => {
			// 		new FSWatcher(tmp, { recursive: true, depth: 2 })
			// 			.on('change', evt => {
			// 				if (evt.file.indexOf(tmpDir) === 0) {
			// 					clearTimeout(timer);
			// 					lastEvt = evt;
			// 					checkEvent();
			// 				}
			// 			})
			// 			.on('error', done);
			//
			// 		function writeFile() {
			// 			log(renderTree());
			// 			const file = files[index];
			// 			log('Writing: %s', highlight(file));
			// 			fs.writeFileSync(file, 'test');
			//
			// 			timer = setTimeout(() => {
			// 				// timed out
			// 				log('Timed out');
			// 				checkEvent();
			// 			}, 1000);
			// 		}
			//
			// 		function checkEvent() {
			// 			try {
			// 				if (index < 2) {
			// 					if (!lastEvt) {
			// 						throw new Error('Didn\'t get the fs event!');
			// 					}
			// 					expect(lastEvt.action).to.equal('add');
			// 					expect(lastEvt.file).to.equal(real(files[index]));
			// 				} else if (lastEvt) {
			// 					throw new Error(`Should not have got ${lastEvt.action} for ${lastEvt.file} (depth=${index})`);
			// 				}
			// 			} catch (e) {
			// 				return done(e);
			// 			}
			//
			// 			lastEvt = null;
			//
			// 			if (++index < files.length) {
			// 				writeFile();
			// 			} else {
			// 				done();
			// 			}
			// 		}
			//
			// 		writeFile();
			// 	}, 100);
			// });

			it('should only recursively watch 2 directories deep and then unwatch', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const wizDir = path.join(tmp, 'foo', 'bar', 'baz', 'wiz');
				log('Creating wiz directory: %s', highlight(wizDir));
				fs.mkdirsSync(wizDir);

				const files = [
					path.join(tmp, 'test.txt'),
					path.join(tmp, 'foo', 'foo-test.txt'),
					path.join(tmp, 'foo', 'bar', 'bar-test.txt'),
					path.join(tmp, 'foo', 'bar', 'baz', 'baz-test.txt'),
					path.join(tmp, 'foo', 'bar', 'baz', 'wiz', 'wiz-test.txt')
				];
				let index = 0;
				let lastEvt;
				let timer;

				setTimeout(() => {
					const watcher = new FSWatcher(tmp, { recursive: true, depth: 2 })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								clearTimeout(timer);
								lastEvt = evt;
								checkEvent();
							}
						})
						.on('error', done);

					function writeFile() {
						log(renderTree());
						const file = files[index];
						log('Writing: %s', highlight(file));
						fs.writeFileSync(file, 'test');

						timer = setTimeout(() => {
							// timed out
							log('Timed out');
							checkEvent();
						}, 1000);
					}

					function checkEvent() {
						try {
							if (index < 2) {
								if (!lastEvt) {
									throw new Error('Didn\'t get the fs event!');
								}
								expect(lastEvt.action).to.equal('add');
								expect(lastEvt.file).to.equal(real(files[index]));
							} else if (lastEvt) {
								throw new Error(`Should not have got ${lastEvt.action} for ${lastEvt.file} (depth=${index})`);
							}
						} catch (e) {
							return done(e);
						}

						lastEvt = null;

						if (++index < files.length) {
							writeFile();
						} else {
							log('Closing watcher');
							expect(watcher.close()).to.be.true;

							setTimeout(() => {
								const stats = status();
								expect(stats.nodes).to.equal(0);
								expect(stats.fswatchers).to.equal(0);
								expect(stats.watchers).to.equal(0);
								done();
							}, 1000);
						}
					}

					writeFile();
				}, 100);
			});

			it('should recursively watch with two watchers; one with depth of 2', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const wizDir = path.join(tmp, 'foo', 'bar', 'baz', 'wiz');
				log('Creating wiz directory: %s', highlight(wizDir));
				fs.mkdirsSync(wizDir);

				const files = [
					path.join(tmp, 'test.txt'),
					path.join(tmp, 'foo', 'foo-test.txt'),
					path.join(tmp, 'foo', 'bar', 'bar-test.txt'),
					path.join(tmp, 'foo', 'bar', 'baz', 'baz-test.txt'),
					path.join(tmp, 'foo', 'bar', 'baz', 'wiz', 'wiz-test.txt')
				];
				let index = 0;
				let lastEvt;
				let timer;
				let counter = 0;
				let firstCounter = 0;
				let secondCounter = 0;

				setTimeout(() => {
					new FSWatcher(tmp, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								firstCounter++;
								if (++firstCounter >= files.length) {
									finalize();
								}
							}
						})
						.on('error', done);

					new FSWatcher(tmp, { recursive: true, depth: 2 })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								clearTimeout(timer);
								lastEvt = evt;
								checkEvent();
							}
						})
						.on('error', done);

					function writeFile() {
						log(renderTree());
						const file = files[index];
						log('Writing: %s', highlight(file));
						fs.writeFileSync(file, 'test');

						timer = setTimeout(() => {
							// timed out
							log('Timed out');
							checkEvent();
						}, 1000);
					}

					function checkEvent() {
						try {
							if (index < 2) {
								if (!lastEvt) {
									throw new Error('Didn\'t get the fs event!');
								}
								expect(lastEvt.action).to.equal('add');
								expect(lastEvt.file).to.equal(real(files[index]));
							} else if (lastEvt) {
								throw new Error(`Should not have got ${lastEvt.action} for ${lastEvt.file} (depth=${index})`);
							}
						} catch (e) {
							return done(e);
						}

						lastEvt = null;
						secondCounter++;

						if (++index < files.length) {
							writeFile();
						} else {
							finalize();
						}
					}

					function finalize() {
						if (++counter === 2) {
							try {
								expect(secondCounter).to.equal(3);
								done();
							} catch (e) {
								done(e);
							}
						}
					}

					writeFile();
				}, 100);
			});
		});

		describe('symlinks', () => {
			it('should handle if symlink to directory is broken', function (done) {
				this.timeout(10000);
				this.slow(8000);

				let counter = 0;
				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				const barDir = path.join(fooDir, 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizDir = path.join(real(tmp), 'baz', 'wiz');
				const wizDir = path.join(bazDir, 'wiz');

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(realWizDir);

										log(renderTree());
										log('Removing bar: %s', highlight(barDir));
										fs.removeSync(barDir);
										break;

									case 2:
										expect(evt.action).to.equal('change');
										expect(evt.file).to.equal(realWizDir);
										done();
								}
							}
						})
						.on('error', done);

					log('Creating symlink: %s', highlight(wizDir));
					fs.symlinkSync(barDir, wizDir);
				}, 100);
			});

			it('should handle symlink to directory being deleted', function (done) {
				this.timeout(10000);
				this.slow(8000);

				let counter = 0;
				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				const barDir = path.join(fooDir, 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizDir = path.join(real(tmp), 'baz', 'wiz');
				const wizDir = path.join(bazDir, 'wiz');

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(realWizDir);

										log(renderTree());
										log('Unlinking wiz: %s', highlight(wizDir));
										fs.unlinkSync(wizDir);
										break;

									case 2:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(realWizDir);
										done();
								}
							}
						})
						.on('error', done);

					log('Creating symlink: %s', highlight(wizDir));
					fs.symlinkSync(barDir, wizDir);
				}, 100);
			});

			it('should handle if symlink to file is broken', function (done) {
				this.timeout(10000);
				this.slow(8000);

				let counter = 0;
				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				log('Creating foo directory: %s', highlight(fooDir));
				fs.mkdirsSync(fooDir);

				const barFile = path.join(fooDir, 'bar.txt');
				log('Writing %s', highlight(barFile));
				fs.writeFileSync(barFile, 'bar!');

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizFile = path.join(real(tmp), 'baz', 'wiz.txt');
				const wizFile = path.join(bazDir, 'wiz.txt');

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(realWizFile);

										log(renderTree());
										log('Removing %s', highlight(barFile));
										fs.removeSync(barFile);
										break;

									case 2:
										expect(evt.action).to.equal('change');
										expect(evt.file).to.equal(realWizFile);
										done();
								}
							}
						})
						.on('error', done);

					log('Creating symlink: %s', highlight(wizFile));
					fs.symlinkSync(barFile, wizFile);
				}, 100);
			});

			it('should handle symlink to file being deleted', function (done) {
				this.timeout(10000);
				this.slow(8000);

				let counter = 0;
				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				log('Creating foo directory: %s', highlight(fooDir));
				fs.mkdirsSync(fooDir);

				const barFile = path.join(fooDir, 'bar.txt');
				log('Writing %s', highlight(barFile));
				fs.writeFileSync(barFile, 'bar!');

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizFile = path.join(real(tmp), 'baz', 'wiz.txt');
				const wizFile = path.join(bazDir, 'wiz.txt');

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								switch (++counter) {
									case 1:
										expect(evt.action).to.equal('add');
										expect(evt.file).to.equal(realWizFile);

										log(renderTree());
										log('Unlinking wiz: %s', highlight(wizFile));
										fs.unlinkSync(wizFile);
										break;

									case 2:
										expect(evt.action).to.equal('delete');
										expect(evt.file).to.equal(realWizFile);
										done();
								}
							}
						})
						.on('error', done);

					log('Creating symlink: %s', highlight(wizFile));
					fs.symlinkSync(barFile, wizFile);
				}, 100);
			});

			it('should handle if already broken absolute directory symlink', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				const barDir = path.join(fooDir, 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizDir = path.join(real(tmp), 'baz', 'wiz');
				const wizDir = path.join(bazDir, 'wiz');

				log('Creating symlink: %s', highlight(wizDir));
				fs.symlinkSync(barDir, wizDir);

				log('Deleting %s', highlight(barDir));
				fs.removeSync(barDir);

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								expect(evt.action).to.equal('change');
								expect(evt.file).to.equal(realWizDir);
								done();
							}
						})
						.on('error', done);

					setTimeout(() => {
						log(renderTree());
						log('Recreating foo/bar directory: %s', highlight(barDir));
						fs.mkdirsSync(barDir);
					}, 100);
				}, 500);
			});

			it('should handle if already broken relative directory symlink', function (done) {
				this.timeout(10000);
				this.slow(8000);

				const tmp = makeTempDir();
				log('Creating temp directory: %s', highlight(tmp));

				const fooDir = path.join(tmp, 'foo');
				const barDir = path.join(fooDir, 'bar');
				log('Creating foo/bar directory: %s', highlight(barDir));
				fs.mkdirsSync(barDir);

				const bazDir = path.join(tmp, 'baz');
				log('Creating baz directory: %s', highlight(bazDir));
				fs.mkdirsSync(bazDir);

				const realWizDir = path.join(real(tmp), 'baz', 'wiz');
				const wizDir = path.join(bazDir, 'wiz');

				const barRelDir = '../foo/bar';

				log('Creating symlink: %s → %s', highlight(barRelDir), highlight(wizDir));
				fs.symlinkSync(barRelDir, wizDir);

				log('Deleting %s', highlight(barDir));
				fs.rmdirSync(barDir);

				setTimeout(() => {
					new FSWatcher(bazDir, { recursive: true })
						.on('change', evt => {
							if (evt.file.indexOf(tmpDir) === 0) {
								// console.log(evt);

								expect(evt.action).to.equal('change');
								expect(evt.file).to.equal(realWizDir);
								done();
							}
						})
						.on('error', done);

					setTimeout(() => {
						log(renderTree());
						log('Recreating foo/bar directory: %s', highlight(barDir));
						fs.mkdirsSync(barDir);
					}, 100);
				}, 500);
			});
		});

		describe('errors', () => {
			it('should emit error if directory watch handler throws exception', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');

				setTimeout(() => {
					new FSWatcher(tmp)
						.on('change', () => {
							throw new Error('Oh no!');
						})
						.on('error', err => {
							try {
								expect(err).to.be.an.instanceof(Error);
								expect(err.message).to.equal('Oh no!');
								done();
							} catch (e) {
								done(e);
							}
						});

					fs.writeFileSync(filename, 'foo!');
				}, 100);
			});

			it('should emit error if file watch handler throws exception', done => {
				const tmp = makeTempDir();
				const filename = path.join(tmp, 'foo.txt');
				fs.writeFileSync(filename, 'foo!');

				setTimeout(() => {
					new FSWatcher(filename)
						.on('change', () => {
							throw new Error('Oh no!');
						})
						.on('error', err => {
							try {
								expect(err).to.be.an.instanceof(Error);
								expect(err.message).to.equal('Oh no!');
								done();
							} catch (e) {
								done(e);
							}
						});

					fs.appendFileSync(filename, 'more foo!');
				}, 100);
			});
		});
	});

	describe('register', () => {
		it('should throw error if path is not a string', () => {
			expect(() => {
				register();
			}).to.throw(TypeError, 'Expected path to be a string');

			expect(() => {
				register(123);
			}).to.throw(TypeError, 'Expected path to be a string');
		});

		it('should throw error if watcher is invalid', () => {
			expect(() => {
				register('/', 123);
			}).to.throw(TypeError, 'Expected watcher to be a FSWatcher instance');

			expect(() => {
				register('/', 'foo!');
			}).to.throw(TypeError, 'Expected watcher to be a FSWatcher instance');
		});
	});

	describe('unregister', () => {
		afterEach(() => {
			reset();
			log(renderTree());
		});

		it('should throw error if path is not a string', () => {
			expect(() => {
				unregister();
			}).to.throw(TypeError, 'Expected path to be a string');

			expect(() => {
				unregister(123);
			}).to.throw(TypeError, 'Expected path to be a string');
		});

		it('should return false if unregistering an invalid path', () => {
			const watcher = new FSWatcher('/foo');
			expect(unregister('/bar', watcher)).to.be.false;
		});

		it('should throw error if watcher is invalid', () => {
			expect(() => {
				unregister(__dirname, 123);
			}).to.throw(TypeError, 'Expected watcher to be a FSWatcher instance');

			expect(() => {
				unregister(__dirname, 'foo!');
			}).to.throw(TypeError, 'Expected watcher to be a FSWatcher instance');
		});
	});
});
