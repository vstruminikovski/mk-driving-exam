'use strict';
/* =========================================================================
   SCENARIOS — examination routes and tasks
   Route = ordered list of directed road segments ("from>to").
   Turn instructions are generated automatically from the route.
   ========================================================================= */

const SCENARIOS = [
  {
    id: 'straight', title: 'Право возење низ град', icon: 'straight',
    desc: 'Возете по булеварот низ две раскрсници со семафори, одржувајте брзина и лента, па запрете покрај тротоарот.',
    start: { key: 'n01>n11', lane: 1, s: 12 },
    route: ['n01>n11', 'n11>n21', 'n21>n31'],
    intro: 'Возете право по булеварот. Одржувајте соодветна брзина и останете во десната лента.',
    tasks: [{ type: 'pullOver', key: 'n21>n31', at: 45 }],
  },
  {
    id: 'left', title: 'Свртување лево', icon: 'left',
    desc: 'Лево свртување на раскрсница со семафор. Дадете трепкач, позиционирајте се и пропуштете ги возилата од спротивната насока.',
    start: { key: 'n12>n11', lane: 0, s: 78 },
    route: ['n12>n11', 'n11>n01'],
    light: { node: 'n11', phase: 2, el: 0 },
    tasks: [
      { type: 'spawn', key: 'n12>n11', at: 80, spawns: [
        { key: 'n10>n11', lane: 0, s: 70, v: 10, route: ['n11>n12'] },
        { key: 'n10>n11', lane: 0, s: 45, v: 10, route: ['n11>n12'] }] },
      { type: 'reach', key: 'n11>n01', s: 55 },
    ],
  },
  {
    id: 'right', title: 'Свртување десно', icon: 'right',
    desc: 'Десно свртување на семафор. Внимавајте на пешаците што го минуваат коловозот во кој свртувате.',
    start: { key: 'n11>n21', lane: 1, s: 70 },
    route: ['n11>n21', 'n21>n22'],
    light: { node: 'n21', phase: 5, el: 0 },
    tasks: [
      { type: 'peds', key: 'n11>n21', at: 105, cwEdge: 'n21-n22', end: 'a', count: 2 },
      { type: 'reach', key: 'n21>n22', s: 45 },
    ],
  },
  {
    id: 'light', title: 'Раскрсница со семафор', icon: 'light',
    desc: 'Приближете се кон семафор што се менува. Запрете пред стоп-линијата на црвено и продолжете на зелено.',
    start: { key: 'n20>n21', lane: 0, s: 18 },
    route: ['n20>n21', 'n21>n22'],
    light: { node: 'n21', phase: 3, el: 8 },
    intro: 'Внимавајте на семафорот.',
    tasks: [{ type: 'reach', key: 'n21>n22', s: 40 }],
  },
  {
    id: 'ped', title: 'Пешачки премин', icon: 'ped',
    desc: 'Препознајте пешак на необезбеден премин и пропуштете го. Потоа запрете пред следниот премин по барање на испитувачот.',
    start: { key: 'n10>n20', lane: 0, s: 8 },
    route: ['n10>n20', 'n20>n21'],
    tasks: [
      { type: 'yieldPed', key: 'n10>n20', cwEdge: 'n10-n20', along: 85 },
      { type: 'stopCw', key: 'n20>n21', cwEdge: 'n20-n21', along: 75 },
      { type: 'reach', key: 'n20>n21', s: 100 },
    ],
  },
  {
    id: 'priority', title: 'Раскрсница со предност', icon: 'car',
    desc: 'Споредна улица со знак STOP. Запрете целосно и пропуштете ги возилата на главниот пат.',
    start: { key: 'n11>n12', lane: 0, s: 76 },
    route: ['n11>n12', 'n12>n13'],
    tasks: [
      { type: 'yieldVeh', key: 'n11>n12', at: 78 },
      { type: 'reach', key: 'n12>n13', s: 40 },
    ],
  },
  {
    id: 'round', title: 'Кружен тек', icon: 'round',
    desc: 'Влезете безбедно во кружниот тек, пропуштете ги возилата во него и излезете на вториот излез.',
    start: { key: 'n12>n22', lane: 0, s: 40 },
    route: ['n12>n22', 'n22>n32'],
    tasks: [
      { type: 'spawn', key: 'n12>n22', at: 85, spawns: [
        { key: 'n21>n22', lane: 0, s: 80, v: 8, route: ['n22>n23'] },
        { key: 'n32>n22', lane: 0, s: 112, v: 8, route: ['n22>n23'] }] },
      { type: 'reach', key: 'n22>n32', s: 45 },
    ],
  },
  {
    id: 'lane', title: 'Менување лента', icon: 'lane',
    desc: 'Престројте се од левата во десната лента: проверете ретровизор, дадете трепкач и почекајте безбеден простор.',
    start: { key: 'n01>n11', lane: 0, s: 12 },
    route: ['n01>n11', 'n11>n12'],
    tasks: [
      { type: 'spawn', key: 'n01>n11', at: 0, spawns: [{ key: 'n01>n11', lane: 1, s: 2, v: 11 }] },
      { type: 'lane', key: 'n01>n11', toLane: 1, at: 18 },
      { type: 'reach', key: 'n11>n12', s: 40 },
    ],
  },
  {
    id: 'obstacle', title: 'Обиколување пречка', icon: 'obstacle',
    desc: 'Паркирано доставно возило ја блокира лентата. Обиколете го безбедно кога спротивната лента е слободна.',
    start: { key: 'n02>n12', lane: 0, s: 10 },
    route: ['n02>n12', 'n12>n13'],
    tasks: [
      { type: 'obstacle', key: 'n02>n12', at: 12 },
      { type: 'reach', key: 'n02>n12', s: 138 },
    ],
  },
  {
    id: 'park', title: 'Паралелно паркирање', icon: 'park',
    desc: 'Паркирајте паралелно во означеното место меѓу две возила. Држете S при мирување за рикверц.',
    start: { key: 'n13>n23', lane: 0, s: 6 },
    route: ['n13>n23', 'n23>n33'],
    tasks: [{ type: 'park', key: 'n13>n23', at: 0 }],
  },
  {
    id: 'pull', title: 'Запирање и тргнување', icon: 'pull',
    desc: 'Запрете паралелно и блиску до тротоарот, па безбедно тргнете повторно со трепкач и проверка на ретровизор.',
    start: { key: 'n20>n30', lane: 0, s: 10 },
    route: ['n20>n30', 'n30>n31'],
    tasks: [
      { type: 'pullOver', key: 'n20>n30', at: 35 },
      { type: 'reach', key: 'n30>n31', s: 45 },
    ],
  },
];

const FULL_EXAM = {
  id: 'exam', title: 'Практичен испит', icon: 'flag',
  desc: 'Целосен испит низ градот.',
  start: { key: 'n01>n11', lane: 0, s: 12 },
  route: ['n01>n11', 'n11>n12', 'n12>n22', 'n22>n21', 'n21>n11', 'n11>n01', 'n01>n02', 'n02>n12', 'n12>n13', 'n13>n23', 'n23>n33'],
  tasks: [
    { type: 'lane', key: 'n01>n11', toLane: 1, at: 16 },
    { type: 'yieldPed', key: 'n11>n12', cwEdge: 'n11-n12', along: 75 },
    { type: 'yieldVeh', key: 'n11>n12', at: 74 },
    { type: 'spawn', key: 'n22>n21', at: 50, spawns: [
      { key: 'n20>n21', lane: 0, s: 75, v: 10, route: ['n21>n22'] }] },
    { type: 'stopCw', key: 'n11>n01', cwEdge: 'n01-n11', along: 85 },
    { type: 'obstacle', key: 'n02>n12', at: 8 },
    { type: 'park', key: 'n13>n23', at: 0 },
  ],
};

const PRACTICE = {
  id: 'practice', title: 'Вежбање', icon: 'info',
  start: { key: 'n01>n11', lane: 1, s: 12 },
  route: ['n01>n11'],
  tasks: [],
};
