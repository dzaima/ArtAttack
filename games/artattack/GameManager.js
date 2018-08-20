define([
	'fetch/entryUtils',
], (
	entryUtils,
) => {
	'use strict';

	// This is the core runner for your game.
	// One GameManager will be created for each game (no need to clean up state)
	// It will run inside a sandboxed web worker, so you don't need to worry
	// about breaking up long-running calculations.
	// You may get some requests to change the game configuration and entries
	// (updateConfig and updateEntry). You can allow as much or as little
	// changing as you like, but it's generally better for debugging if as
	// much as possible is editable (e.g. it makes sense to allow changing the
	// maximum frame on-the-fly, but probably doesn't make sense to allow
	// changing the grid size. Also it makes sense to allow updating an existing
	// competitor, but probably doesn't make sense to add a new competitor)

	return class GameManager {
		constructor(random, gameConfig) {
			this.gameConfig = gameConfig;
			this.random = random; // a seeded random object you can use
			this.teams = gameConfig.teams;
      this.boardSize = this.teams.length * 3;
			this.board = new Array(this.boardSize).fill(0).map(c=>new Array(this.boardSize).fill(0)); //.map(c=>random.next(this.teams.length));
			this.frame = 0;
			this.simulationTime = 0;
			this.playerColors = this.teams.map(c=>new Array(3).fill(0).map(c=>random.next(120)+100));
			this.playerColors.unshift([255,255,255]);
			// gameConfig contains:
			// - seed: the current game seed. Typically you won't need to check
			//         this because the random object is pre-seeded
			// - teams: the list of teams competing in this game. Each entry
			//          also contains an 'entries' list (in free-for-all games,
			//          each team will have exactly 1 entry)
			
			this.entryLookup = new Map();
			var colors = new Array(this.teams.length).fill(0).map((_,i)=>i+1);
			for (let c of this.teams) {
				let entry = c.entries[0];
				let col = colors.splice(random.next(colors.length-1),1)[0];
				this.entryLookup.set(entry.id, {
					x: random.next(this.boardSize),
					y: random.next(this.boardSize),
					col,
					entryID: entry.id,
					teamID: c.id,
					localStorage: {},
					elapsedTime: 0,
					disqualified: false,
					codeSteps: 0,
				})
				c.rgb = '#'+this.playerColors[col].map(c=>c.toString(16).padStart(2,0)).join('');
				this.updateEntry({id: entry.id, code: entry.code, pauseOnError: entry.pauseOnError, disqualified: false});
			}
			console.log("GAME START", this.entryLookup, this.teams, this);
			
			// gameConfig.width = gameConfig.height = this.boardSize;
			// console.log(this);
		}

		updateEntry({
			id,
			code = null,
			pauseOnError = null,
			disqualified = null,
			/* other props you care about */
		}) {
			const entry = this.entryLookup.get(id);
			if(!entry) {
				throw new Error('Attempt to modify entry '+id+' which was not registered in the game');
			}
			if(code !== null) {
				// These parameter names match the key values given to fn() in
				// step(type) below
				const compiledCode = entryUtils.compile("return ("+code+")(myself, grid, bots, gameInfo)", [
					'myself', 'grid', 'bots', 'gameInfo', 'window', 'localStorage'
				], {pre: 'Math.random = extras.MathRandom;'});
				entry.fn = compiledCode.fn;
				if(compiledCode.compileError) {
					entry.disqualified = true;
					entry.error = compiledCode.compileError;
				} else {
					// Automatically un-disqualify entries when code is updated
					entry.error = null;
					entry.disqualified = false;
				}
				entry.errorInput = null;
				entry.errorOutput = null;
			}
			if(pauseOnError !== null) {
				entry.pauseOnError = pauseOnError;
			}
			if(disqualified !== null) {
				entry.disqualified = disqualified;
			}
			// Handle any other props you care about here
		}

		updateConfig(gameConfig) {
			// Update anything which makes sense to change mid-game here
			this.gameConfig = gameConfig;
			gameConfig.playerColors = this.playerColors;
		}

		// This is an internal method; you can change the arguments to whatever
		// you need when handling errors
		handleError(entry, params, action, error) {
			console.log("Error:",entry, params, action, error);
			// errorInput, errorOutput, and error are presented to the user.
			// Fill them in with something useful. For example:
			entry.errorInput = JSON.stringify(params);
			entry.errorOutput = JSON.stringify(action);
			entry.error = (
				error + ' (gave ' + entry.errorOutput +
				' for ' + entry.errorInput + ')'
			);
			this.random.rollback();
			throw 'PAUSE';
		}

		step(type) {
			const begin = performance.now();
			if (this.frame >= this.maxFrame) return;
			// this.board[this.random.next(this.board.length)][this.random.next(this.board.length)] = this.random.next(this.teams.length)
			this.random.save();
			var results = new Array(this.teams.length);
			var grid = JSON.parse(JSON.stringify(this.board));
			var bots = [...this.entryLookup.values()].map(c => [c.col, c.x, c.y]);
			var gameInfo = [this.frame, this.maxFrame];
			//console.log(window.localStorage);
			var i = 0;
			for (var [id, entry] of this.entryLookup) {
				if (entry.disqualified) {
					results[i++] = {entry, action: "nothing"};
					continue;
				}
				var myself = [entry.col, entry.x, entry.y];
				var localStorage = entry.localStorage;
				const params = {
					myself,
					grid,
					bots,
					gameInfo,
					window: {localStorage},
					localStorage
				};
				let error = null;
				let action = null;
				let elapsed = 0;
				
				try {
					const begin = performance.now();
				  action = entry.fn(params, {consoleTarget: {push: a => console[a.type](a.value)}, MathRandom: ()=>this.random.nextFloat()}); //consoleTarget: entry.console   consoleTarget:console
					elapsed = performance.now() - begin;
				} catch(e) {
					error = entryUtils.stringifyEntryError(e);
				}
				entry.elapsedTime += elapsed;
				++ entry.codeSteps;
				if (error) {
					this.handleError(entry, params, action, error);
				}
				results[i++] = {entry, action};
			}
			for (let {entry, action} of results) {
				if (entry.disqualified) continue;
				if (action == "up") {
					entry.y -= 1;
					if (entry.y < 0) entry.y = 0;
				} else if (action == "down") {
					entry.y += 1;
					if (entry.y >= this.boardSize) entry.y = this.boardSize-1;
				} else if (action == "right") {
					entry.x += 1;
					if (entry.x >= this.boardSize) entry.x = this.boardSize-1;
				} else if (action == "left") {
					entry.x -= 1;
					if (entry.x < 0) entry.x = 0;
				}

				if (this.board[entry.x][entry.y] > 0) {
					this.board[entry.x][entry.y] = [entry.col, 0, this.board[entry.x][entry.y]][Math.abs(entry.col-this.board[entry.x][entry.y])%3];
				} else {
					this.board[entry.x][entry.y] = entry.col;
				}
			}
			
			for (var [id, entry] of this.entryLookup) { // player+player = 0
				if (entry.disqualified) continue;
				for (var [id2, entry2] of this.entryLookup) { // player+player = 0
					if (!entry2.disqualified && entry != entry2 && entry.x == entry2.x && entry.y == entry2.y) {
						this.board[entry.x][entry.y] = 0;
					}
				}
			}
			
			if (this.frame>=5) { // eliminating
				var found = new Array(this.teams.length+1).fill(0);
				for (var col of this.board) for (var item of col) found[item]++;
				for (let [id, entry] of this.entryLookup) {
					if (found[entry.col] <= 1) {
						entry.disqualified=true;
					}
				}
			}
			
			this.frame++;
			this.simulationTime += performance.now() - begin;
		}

		isOver() {
			// Return false until your game is over, then true.
			return this.frame >= this.gameConfig.maxFrame;
		}

		getState() {
			// This will be used by some internal management tasks, and will be
			// given to your Display and GameScorer classes.
			return {
				// Framework data
				over: this.isOver(), // when true, the game stops

				// Game specific data
				// Put anything you like here, but make sure you have teams:
				size: this.boardSize,
				board: this.board,
				progress: this.frame / this.gameConfig.maxFrame,
				// allEntries: [...this.entryLookup.entries()].map(c=>c[1]),
				frame: this.frame,
				simulationTime: this.simulationTime,
				maxFrame: this.gameConfig.maxFrame,
				playerColors: this.playerColors,
				teams: this.teams.map((team) => ({
					id: team.id,
					rgb: team.rgb,
					entries: team.entries.map((entryState) => {
						const entry = this.entryLookup.get(entryState.id);
						return {
							id: entryState.id,
							disqualified: entry.disqualified,
							title: entryState.title,
							
							elapsedTime: entry.elapsedTime,
							codeSteps: entry.codeSteps,
							error: entryState.error,
							errorInput: entryState.errorInput,
							errorOutput: entryState.errorOutput,
							console: entryState.console,
							col: entry.col,
							x: entry.x,
							y: entry.y,
						};
					}),
				})),
			};
		}
	};
});
