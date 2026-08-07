import { expect } from 'chai';
import { suite, test } from 'mocha';

import { parseMapFile, parseNmOutput, parseObjdumpSections } from '../../memoryAnalyzer';

suite('Memory analyzer', () => {
  test('parses linker memory regions and output sections', () => {
    const result = parseMapFile([
      'Memory Configuration',
      'Name             Origin             Length',
      'FLASH            0x08000000         0x00010000',
      'RAM              0x20000000         0x00002000',
      'Linker script and memory map',
      ' .text           0x08000000         0x00000120',
      ' .data           0x20000000         0x00000020',
    ].join('\n'));

    expect(result.regions).to.deep.include({ name: 'FLASH', origin: 0x08000000, size: 0x10000, used: 0x120 });
    expect(result.regions).to.deep.include({ name: 'RAM', origin: 0x20000000, size: 0x2000, used: 0x20 });
    expect(result.sections).to.deep.include({ name: '.text', address: 0x08000000, size: 0x120, region: 'FLASH' });
  });

  test('accepts linker region names containing punctuation', () => {
    const result = parseMapFile([
      'Memory Configuration',
      'ITCM-RAM$0           0x00000000         0x00001000',
      '*default*            0x00000000         0xffffffff',
      'Linker script and memory map',
    ].join('\n'));

    expect(result.regions).to.deep.equal([{
      name: 'ITCM-RAM$0',
      origin: 0,
      size: 0x1000,
      used: 0,
    }]);
  });

  test('parses nm symbols and source locations', () => {
    expect(parseNmOutput('08000000 00000010 T Reset_Handler startup_stm32.c:42\n')).to.deep.equal([{
      name: 'Reset_Handler',
      address: 0x08000000,
      size: 0x10,
      type: 'T',
      source: 'startup_stm32.c:42',
      sourceFile: 'startup_stm32.c',
      sourceLine: 42,
    }]);
  });

  test('keeps source-bearing records when nm emits an identical duplicate', () => {
    const symbols = parseNmOutput([
      '20000000 00000004 D uwTickFreq',
      '20000000 00000004 D uwTickFreq system.c:12',
    ].join('\n'));

    const unique = new Map(symbols.map((symbol) => [
      `${symbol.name}:${symbol.address}:${symbol.size}:${symbol.type}`,
      symbol,
    ]));
    expect(unique.size).to.equal(1);
    expect(Array.from(unique.values())[0].sourceFile).to.equal('system.c');
  });

  test('keeps zero-sized and demangled symbols exactly as nm reports them', () => {
    expect(parseNmOutput([
      '08000000 00000000 T __vector_table startup.s:8',
      '08000010 00000020 T Widget::begin() const\twidget.cpp:17',
    ].join('\n'))).to.deep.equal([
      {
        name: '__vector_table',
        address: 0x08000000,
        size: 0,
        type: 'T',
        source: 'startup.s:8',
        sourceFile: 'startup.s',
        sourceLine: 8,
      },
      {
        name: 'Widget::begin() const',
        address: 0x08000010,
        size: 0x20,
        type: 'T',
        source: 'widget.cpp:17',
        sourceFile: 'widget.cpp',
        sourceLine: 17,
      },
    ]);
  });

  test('parses only allocated top-level ELF sections', () => {
    const output = [
      '  0 .text         00000300  08000198  08000198  00000198  2**2',
      '                  CONTENTS, ALLOC, LOAD, READONLY, CODE',
      '  1 .debug_info   00001000  00000000  00000000  00000498  2**0',
      '                  CONTENTS, READONLY, DEBUGGING',
      '  2 .data         0000000c  20000000  08000498  00000498  2**2',
      '                  CONTENTS, ALLOC, LOAD, DATA',
    ].join('\n');

    expect(parseObjdumpSections(output)).to.deep.equal([
      { name: '.text', size: 0x300, address: 0x08000198, loadAddress: 0x08000198 },
      { name: '.data', size: 0x0c, address: 0x20000000, loadAddress: 0x08000498 },
    ]);
  });

  test('keeps init and fini array sections as allocated output sections', () => {
    const output = [
      '  6 .init_array   00000004  08002ff8  08002ff8  00003ff8  2**2',
      '                  CONTENTS, ALLOC, LOAD, READONLY, DATA',
      '  7 .fini_array   00000004  08002ffc  08002ffc  00003ffc  2**2',
      '                  CONTENTS, ALLOC, LOAD, READONLY, DATA',
    ].join('\n');

    expect(parseObjdumpSections(output)).to.deep.include.members([
      { name: '.init_array', size: 4, address: 0x08002ff8, loadAddress: 0x08002ff8 },
      { name: '.fini_array', size: 4, address: 0x08002ffc, loadAddress: 0x08002ffc },
    ]);
  });
});
