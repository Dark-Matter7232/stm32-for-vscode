
import createMakefile, {
  createGCCPathOutput,
  createSingleLineStringList,
  createStringList,
} from '../../CreateMakefile';
import { suite, test } from 'mocha';

import MakeInfo from '../../types/MakeInfo';
import { expect } from 'chai';

// TODO: add library testing in the mix. 
// TODO: add a test for adding flags.
suite('CreateMakefile', () => {
  test('check for proper line endings on string list', () => {
    const testEntries = ['hi', 'hello', 'some/filename.txt'];
    const expectedResult = 'hello \\\nhi \\\nsome/filename.txt\n';
    const result = createStringList(testEntries);
    expect(result).to.equal(expectedResult);
  });

  test('single line stringlist', () => {
    const testArray = ['hello', 'beautiful', 'world'];
    const expectedResult = 'beautiful hello world ';
    const result = createSingleLineStringList(testArray);
    expect(result).to.equal(expectedResult);

  });
  test('outputs empty string on empty array', () => {
    const result = createStringList([]);
    expect(result).to.equal('');
  });
  test('if GCC Path is not added when gcc is in path', () => {
    const makeInfo = new MakeInfo();
    makeInfo.tools.armToolchainPath = '.';
    expect(createGCCPathOutput(makeInfo)).to.equal('');
  });
  test('if custom makefileRules are added', () => {
    const makeInfo = new MakeInfo();
    const customMakefileRules = [
      {
        command: 'sayhi',
        rule: "echo sayhi"
      },
    ];
    makeInfo.customMakefileRules = customMakefileRules;
    const makefileOutput = createMakefile(makeInfo);
    expect(makefileOutput).to.contain(customMakefileRules[0].command);
    expect(makefileOutput).to.contain(customMakefileRules[0].rule);
  });

  test('uses the configured optimization for both build profiles', () => {
    const makeInfo = new MakeInfo();
    makeInfo.optimization = 'O2';
    const makefileOutput = createMakefile(makeInfo);
    expect(makefileOutput).to.contain(
      'OPTIMIZATION_FLAG = $(if $(filter -%,$(OPTIMIZATION)),$(OPTIMIZATION),-$(OPTIMIZATION))'
    );
    expect(makefileOutput).to.contain('OPTIMIZATION_FLAGS += $(OPTIMIZATION_FLAG) -g -gdwarf -ggdb -DDEBUG');
    expect(makefileOutput).to.contain('OPTIMIZATION_FLAGS += $(OPTIMIZATION_FLAG)\n');
    expect(makefileOutput).to.not.contain('OPTIMIZATION_FLAGS += -Og');
  });

  test('uses a response file for the object list', () => {
    const makefileOutput = createMakefile(new MakeInfo());
    expect(makefileOutput).to.contain('$(file >$@.in,$(foreach obj,$(OBJECTS),$(obj)$(\\n)))');
    expect(makefileOutput).to.contain('@$@.in $(LDFLAGS) -o $@');
  });

});
