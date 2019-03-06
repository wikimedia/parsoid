#!/usr/bin/env node
/*
Token transform unit test system

Purpose:
 During the porting of Parsoid to PHP, we need a system to capture
 and replay Javascript Parsoid token handler behavior and performance
 so we can duplicate the functionality and verify adequate performance.

 The transformerTest.js program works in concert with Parsoid and special
 capabilities added to the TokenTransformationManager.js file which
 now has token transformer test generation capabilities that produce test
 files from existing wiki pages or any wikitext. The Parsoid generated tests
 contain the specific handler name chosen for generation and the pipeline
 that was associated with the transformation execution. The pipeline ID
 is used by transfoermTest.js to properly order the replaying of the
 transformers input and output sequencing for validation.

 Manually written tests are supported and use a slightly different format
 which more closely resembles parserTest.txt and allows the test writer
 to identify each test with a unique description and combine tests
 for different token handlers in the same file, though only one handlers
 code can be validated and performance timed.

Technical details:
 The test validator and handler runtime emulates the normal
 Parsoid token transform manager behavior and handles tests sequences that
 were generated by multiple pipelines and uses the pipeline ID to call
 the transformers in sorted execution order to deal with parsoids
 execution order not completing each pipelined sequence in order.
 The system utilizes the transformers initialization code to install handler
 functions in a generalized way and run the test without specific
 transformer bindings.

 To create a test from an existing wikitext page, run the following
 commands, for example:
 $ node bin/parse.js --genTest QuoteTransformer --genTestOut quoteTestFile.txt --pageName 'skating' < /dev/null > /dev/null

 For command line options and required parameters, type:
 $ node bin/transformerTest.js --help

 An example command line to validate and performance test the 'skating'
 wikipage created as a QuoteTransformer test:
 $ node bin/transformTests.js --log --QuoteTransformer --inputFile quoteTestFile.txt

 There are also manually-written unit tests, which are run as follows:
 $ node bin/transformTests.js --manual --ListHandler --inputFile tests/transformTests.txt

 There are a number of tests in tests/transform directory.  To regenerate
 these, use:
 $ tools/regen-transformTests.sh

 To run these pregenerated tests, use:
 $ npm run transformTests
*/

'use strict';

var yargs = require('yargs');
var fs = require('fs');
var JSUtils = require('../lib/utils/jsutils.js').JSUtils;
var MockEnv = require('../tests/MockEnv.js').MockEnv;
var ScriptUtils = require('../tools/ScriptUtils.js').ScriptUtils;
var TokenUtils = require('../lib/utils/TokenUtils.js').TokenUtils;

var cachedState = false;
var cachedTestLines = '';
var cachedPipeLines = '';
var cachedPipeLinesLength = [];

function MockTTM(env, options) {
	this.env = env;
	this.pipelineId = 0;
	this.options = options;
	this.tokenTime = 0; // floating-point value (# ms)
}

var getToken = function(str) {
	return JSON.parse(str, (k, v) => TokenUtils.getToken(v));
};

// Use the TokenTransformManager.js guts (extracted essential functionality)
// to dispatch each token to the registered token transform function
MockTTM.prototype.ProcessTestFile = function(transformer, transformerName, opts) {
	var testName;
	var testFile;
	var testLines;
	var numPasses = 0;
	var numFailures = 0;

	if (opts.timingMode) {
		if (cachedState === false) {
			cachedState = true;
			testFile = fs.readFileSync(opts.inputFile, 'utf8');
			testLines = testFile.split('\n');
			cachedTestLines = testLines;
		} else {
			testLines = cachedTestLines;
		}
	} else {
		testFile = fs.readFileSync(opts.inputFile, 'utf8');
		testLines = testFile.split('\n');
	}

	let testEnabled = true;
	let input = [];
	let result, stringResult;
	for (var index = 0; index < testLines.length; index++) {
		var line = testLines[index];
		switch (line.charAt(0)) {
			case '#':	// comment line
			case ' ':	// blank character at start of line
			case '':	// empty line
				break;
			case ':':
				testEnabled = (line.replace(/^:\s*|\s*$/, '') === transformerName);
				break;
			case '!':	// start of test with name
				testName = line.substr(2);
				break;
			case '[':	// desired result json string for test result verification
				if (!testEnabled) {
					break;
				}
				result = transformer.processTokensSync(null, input, []);
				stringResult = JSON.stringify(result);
				if (stringResult === line) {
					numPasses++;
					if (!opts.timingMode) {
						if (opts.verbose) {
							console.log(testName + ' ==> passed\n');
						}
					}
				} else {
					numFailures++;
					console.log(testName + ' ==> failed');
					console.log('line to debug => ' + line);
					console.log('result line ===> ' + stringResult);
				}
				input = [];
				break;
			case '{':
			default:
				if (!testEnabled) {
					break;
				}
				input.push(getToken(line));
				break;
		}
	}

	return { passes: numPasses, fails: numFailures };
};

// Because tokens are processed in pipelines which can execute out of
// order, the unit test system creates an array of arrays to hold
// the pipeline ID which was used to process each token.
// The ProcessWikitextFile function uses the pipeline IDs to ensure
// that all token processing for each pipeline occurs in order to completion.
function CreatePipelines(lines) {
	var numberOfTextLines = lines.length;
	var maxPipelineID = 0;
	var LineToPipeMap = new Array(numberOfTextLines);
	var i;
	var pipe;
	for (i = 0; i < numberOfTextLines; ++i) {
		pipe = parseInt(lines[i].substr(0, 4), 10);	// pipeline ID's should not exceed 9999
		if (!isNaN(pipe)) {
			if (maxPipelineID < pipe) {
				maxPipelineID = pipe;
			}
		}
		LineToPipeMap[i] = pipe;
	}
	var pipelines = new Array(maxPipelineID + 1);
	for (i = 0; i < numberOfTextLines; ++i) {
		pipe = LineToPipeMap[i];
		if (!isNaN(pipe)) {
			if (pipelines[pipe] === undefined) {
				pipelines[pipe] = [i];
			} else {
				pipelines[pipe].push(i);
			}
		}
	}
	return pipelines;
}

// Use the TokenTransformManager.js guts (extracted essential functionality)
// to dispatch each token to the registered token transform function
MockTTM.prototype.ProcessWikitextFile = function(transformer, opts) {
	var testFile;
	var testLines;
	var pipeLines;
	var pipeLinesLength;

	if (opts.timingMode) {
		if (cachedState === false) {
			cachedState = true;
			testFile = fs.readFileSync(opts.inputFile, 'utf8');
			testLines = testFile.split('\n');
			pipeLines = CreatePipelines(testLines);
			pipeLinesLength = pipeLines.length;
			cachedTestLines = testLines;
			cachedPipeLines = pipeLines;
			cachedPipeLinesLength = pipeLinesLength;
		} else {
			testLines = cachedTestLines;
			pipeLines = cachedPipeLines;
			pipeLinesLength = cachedPipeLinesLength;
		}
	} else {
		testFile = fs.readFileSync(opts.inputFile, 'utf8');
		testLines = testFile.split('\n');
		pipeLines = CreatePipelines(testLines);
		pipeLinesLength = pipeLines.length;
	}
	var numPasses = 0;
	var numFailures = 0;
	let input = [];
	for (var i = 0; i < pipeLinesLength; i++) {
		if (pipeLines[i] !== undefined) {
			transformer.manager.pipelineId = i;
			var pipeLength = pipeLines[i].length;
			for (var j = 0; j < pipeLength; j++) {
				const index = pipeLines[i][j];
				const matches = testLines[index].match(/^.*(IN|OUT)\s*\|\s*(.*)$/);
				const isInput = matches[1] === 'IN';
				const line = matches[2];
				if (isInput) {
					input.push(getToken(line));
				} else {
					// desired result json string for test result verification
					const result = transformer.processTokensSync(null, input, []);
					const stringResult = JSON.stringify(result);
					if (stringResult === line) {
						numPasses++;
						if (!opts.timingMode) {
							if (opts.verbose) {
								console.log('line ' + (pipeLines[i][j] + 1) + ' ==> passed');
							}
						}
					} else {
						numFailures++;
						console.log('line ' + (pipeLines[i][j] + 1) + ' ==> failed');
						console.log('line to debug => ' + line);
						console.log('result line ===> ' + stringResult);
					}
					input = [];
				}
			}
		}
	}

	return { passes: numPasses, fails: numFailures };
};

MockTTM.prototype.unitTest = function(tokenTransformer, transformerName, opts) {
	if (!opts.timingMode) {
		console.log('Starting stand alone unit test running file ' + opts.inputFile);
	}
	var results = tokenTransformer.manager.ProcessTestFile(tokenTransformer, transformerName, opts);
	if (!opts.timingMode) {
		console.log('Ending stand alone unit test running file ' + opts.inputFile);
	}
	return results;
};

MockTTM.prototype.wikitextTest = function(tokenTransformer, opts) {
	if (!opts.timingMode) {
		console.log('Starting stand alone wikitext test running file ' + opts.inputFile);
	}
	var results = tokenTransformer.manager.ProcessWikitextFile(tokenTransformer, opts);
	if (!opts.timingMode) {
		console.log('Ending stand alone wikitext test running file ' + opts.inputFile);
	}
	return results;
};

var opts = yargs.usage('Usage: $0 [--manual] [--timingMode [--iterationCount N]] [--log] --transformer NAME --inputFile /path/filename', {
	help: {
		description: [
			'transformTest.js supports parsoid generated and manually created',
			'test validation. See tests/transformTests.txt to examine and run',
			'a manual test. The --manual flag is optional defaulting to parsoid',
			'generated test format (which has machine generated context to aid',
			'in debugging. The --timingMode flag disables console output and',
			'caches the file IO and related text processing and then iterates',
			'the test 10000 times',
			' The --log option provides additional debug content.',
			'Current handlers supported are: QuoteTransformer, ListHandler',
			'ParagraphWrapper, PreHandler.',
			'TokenStreamPatcher, BehaviorSwitchHandler and SanitizerHandler are',
			'partially implemented, being debugged but not yet usable.\n'
		].join(' ')
	},
	manual: {
		description: 'optional: use manually test format',
		'boolean': true,
		'default': false
	},
	log: {
		description: 'optional: display handler log info',
		'boolean': true,
		'default': false
	},
	verbose: {
		description: 'print pass status for every single line',
		'boolean': true,
		'default': false
	},
	transformer: {
		description: 'Provide the name of the transformer to test',
		'boolean': false,
		'default': null
	},
	timingMode: {
		description: 'Run tests in performance timing mode',
		'boolean': true,
		'default': false
	},
	iterationCount: {
		description: 'How many iterations to run in timing mode?',
		'boolean': false,
		'default': 10000
	},
});

function selectTestType(opts, manager, transformerName, handler) {
	var results;
	var i = opts.timingMode ? Math.round(opts.iterationCount) : 1;
	while (i--) {
		if (opts.manual) {
			results = manager.unitTest(handler, transformerName, opts);
		} else {
			results = manager.wikitextTest(handler, opts);
		}
	}
	return results;
}

function runTests() {
	var argv = opts.argv;

	if (ScriptUtils.booleanOption(argv.help)) {
		opts.showHelp();
		process.exit(1);
	}

	if (!argv.inputFile) {
		opts.showHelp();
		process.exit(1);
	}

	if (argv.timingMode) {
		if (typeof argv.iterationCount !== 'number' || argv.iterationCount < 1) {
			console.log("Iteration count should be a number > 0");
			process.exit(1);
		}
		console.log("\nTiming Mode enabled, no console output expected till test completes\n");
	}

	// look for the wikitext source file in the same path with a .wt file extension
	// and load that so transformers that reference the wikitext source have the actual text.
	var fileName = argv.inputFile.replace(/\.[^.$]+$/, '') + '.wt';
	var mockEnv;
	if (fs.existsSync(fileName)) {
		var testFileWt = fs.readFileSync(fileName, 'utf8');
		mockEnv = new MockEnv(argv, testFileWt);
	} else {
		mockEnv = new MockEnv(argv);
	}

	var manager = new MockTTM(mockEnv, {});
	try {
		var startTime = JSUtils.startTime();
		var TransformerModule;

		switch (argv.transformer) {
			case 'NoInclude':
			case 'IncludeOnly':
			case 'OnlyInclude':
				TransformerModule = require('../lib/wt2html/tt/NoIncludeOnly.js')[argv.transformer];
				break;
			default:
				TransformerModule = require('../lib/wt2html/tt/' + argv.transformer + '.js')[argv.transformer];
		}

		var results = selectTestType(argv, manager, argv.transformer, new TransformerModule(manager, {}));
		var totalTime = JSUtils.elapsedTime(startTime);
		console.log('Total transformer execution time = ' + totalTime.toFixed(3) + ' milliseconds');
		console.log('Total time processing tokens     = ' + manager.tokenTime.toFixed(3) + ' milliseconds');
		console.log('----------------------');
		console.log('Total passes   :', results.passes);
		console.log('Total failures :', results.fails);
		console.log('----------------------');
		if (results.fails) {
			process.exit(1);
		}
	} catch (e) {
		if (!argv.transformer) {
			console.log("Please provide a valid transformer name");
		} else {
			console.log("Exception running transformer " + argv.transformer, e);
		}
		process.exit(1);
	}
}

runTests();
