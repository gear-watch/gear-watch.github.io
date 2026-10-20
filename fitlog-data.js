// Size-chart seed data for Fitlog. Values are body measurements in cm, [min, max].
// Sources checked Oct 2026: kinkprojects.com/sizechart, regulation.co.uk product size tables.
(function () {
  const S6 = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const R = (a, b) => [a, b == null ? a : b];
  function chart(labels, rows) {
    return labels.map((label, i) => {
      const values = {};
      for (const k in rows) { const v = rows[k][i]; values[k] = Array.isArray(v) ? v : R(v); }
      return { label, values };
    });
  }
  window.FITLOG_BRANDS = [
    {
      id: 'kinkprojects', name: 'Kinkprojects', url: 'https://www.kinkprojects.com/sizechart', tol: 3,
      note: 'Body measurements. Garments are cut 10–15% smaller for a tight fit.',
      garments: [
        { name: "Catsuit · women's", sizes: chart(S6, {
          torso: [[136,139],[140,143],[144,147],[149,151],[152,155],[156,159]],
          neck: [32,34,36,38,40,42],
          chest: [[79,82],[84,87],[89,92],[94,97],[100,103],[105,108]],
          armLength: [[50,52],[52,54],[54,56],[56,58],[58,60],[60,62]],
          waist: [[55,58],[59,62],[64,67],[69,72],[74,77],[79,82]],
          hips: [[84,87],[89,92],[94,97],[100,103],[105,108],[110,113]],
          inseam: [[67,69],[69,71],[71,73],[73,75],[75,77],[77,79]],
          height: [[158,162],[163,167],[168,172],[173,177],[176,180],[180,183]] }) },
        { name: "Catsuit · men's", sizes: chart(S6, {
          torso: [[145,147],[149,151],[153,155],[158,160],[162,164],[168,170]],
          neck: [[36,37],[38,39],[40,41],[42,43],[44,45],[46,47]],
          chest: [[89,92],[94,97],[100,103],[105,108],[110,113],[115,118]],
          armLength: [[53,55],[55,57],[57,59],[59,61],[61,63],[63,65]],
          waist: [[69,72],[74,77],[79,82],[84,87],[89,92],[94,97]],
          hips: [[88,91],[93,96],[98,101],[103,106],[108,111],[113,116]],
          inseam: [[65,66],[67,68],[69,70],[71,72],[73,74],[75,76]],
          height: [[165,170],[170,175],[175,180],[180,185],[185,190],[190,195]] }) },
        { name: "Leggings & stockings · women's", sizes: chart(S6, {
          inseam: [[67,69],[69,71],[71,73],[73,75],[75,77],[77,79]],
          thigh: [[41,42],[43,44],[45,46],[47,48],[49,50],[51,52]],
          knee: [[32,33],[34,35],[36,37],[38,39],[40,41],[42,43]],
          ankle: [[19,20],[20,21],[21,22],[22,23],[23,24],[25,26]],
          foot: [[21,22],[22,23],[23,24],[24,25],[25,26],[26,27]] }) },
        { name: "Leggings & stockings · men's", sizes: chart(S6, {
          inseam: [[65,66],[67,68],[69,70],[71,72],[73,74],[75,76]],
          thigh: [[43,45],[45,47],[47,49],[49,51],[51,53],[54,56]],
          knee: [[36,37],[38,39],[40,41],[42,43],[44,45],[46,47]],
          ankle: [[19,20],[21,22],[23,24],[25,26],[26,27],[28,29]],
          foot: [[24,25],[25,26],[26,27],[27,28],[28,29],[29,30]] }) },
        { name: "Hood · women's", sizes: chart(S6, { head: [52,54,56,58,60,62] }) },
        { name: "Hood · men's", sizes: chart(S6, { head: [54,56,58,60,62,64] }) },
        { name: "Gloves · women's", sizes: chart(['S','M','L'], { palm: [[15,16.5],[17,18],[19,19.5]] }) },
        { name: "Gloves · men's", sizes: chart(['S','M','L'], { palm: [[17,18],[19,20],[20,21]] }) }
      ]
    },
    {
      id: 'regulation', name: 'Regulation', url: 'https://regulation.co.uk', tol: 3,
      note: "Men's catsuit, Regular height. Short, Tall and Extra Tall versions also exist.",
      garments: [
        { name: "Catsuit · men's (Regular)", sizes: chart(S6, {
          chest: [[79,83],[83,89],[89,96],[96,104],[104,113],[113,125]],
          waist: [[63,71],[68,78],[74,84],[82,92],[92,104],[105,120]],
          height: [[172,178],[175,181],[177,183],[179,185],[180,185],[180,185]],
          torso: [[146,152],[149,155],[152,158],[155,161],[155,161],[157,163]] }) }
      ]
    },
    (function () {
      const L11 = ['XXS','XS','S','M','L','XL','XXL','3XL','4XL','5XL','6XL'];
      const W = {
        chest: [[77,81],[82,86],[87,91],[92,96],[97,101],[102,106],[107,111],[112,117],[118,124],[125,132],[133,140]],
        waist: [[54,58],[59,63],[64,68],[69,73],[74,78],[79,83],[84,88],[89,94],[95,101],[102,109],[110,117]],
        hips: [[80,84],[85,89],[90,94],[95,99],[100,104],[105,109],[110,114],[115,120],[121,127],[128,135],[136,143]],
        neck: [27,28.5,30,31.5,33,34.5,36,37.5,39,40.5,42],
        upperArm: [25,26,27,28,29,30,31,32,33,34,35],
        thigh: [[43,45],[46,48],[49,51],[52,54],[55,57],[58,60],[61,63],[64,66],[67,69],[70,73],[74,77]] };
      const M = {
        chest: [[82,86],[86.5,91],[91.5,96],[96.5,101],[101.5,106],[106.5,111],[111.5,116.5],[117,122],[122.5,128.5],[129,136],[136.5,143.5]],
        waist: [[64.5,68.5],[69,73.5],[74,78.5],[79,83],[83.5,88],[88.5,93],[93.5,98.5],[99,104],[104.5,110.5],[111,118],[118.5,125.5]],
        hips: [[80.5,84.5],[85,89.5],[90,94.5],[95,99.5],[100,104.5],[105,109.5],[110,114.5],[115,120],[120.5,126.5],[127,134],[134.5,141.5]],
        neck: [35,36.5,38,39.5,41,42,43.5,45,46.5,48,49],
        upperArm: [28,29,30,31.5,33,34.5,36,37.5,39,40.5,42],
        thigh: [[46,48],[49,51],[52,54],[55,57],[58,60],[61,63],[64,66],[67,69],[70,72],[73,76],[77,80]] };
      const step = (a, b, n, d) => Array.from({ length: n }, (_, i) => [a + i * d, b + i * d]);
      const UW = { Petite: step(129,131.5,11,2.5), Regular: step(133.5,136,11,2.5), Tall: step(141.5,144,11,2.5), 'Extra Tall': step(149,151.5,11,2.5) };
      const UM = { Petite: step(143,146,11,3), Regular: step(147,150,11,3), Tall: step(153,156,11,3), 'Extra Tall': step(157,160,11,3) };
      const LW = { Petite: { height: [140,160], insideArm: [42,45], inseam: [64,69] }, Regular: { height: [160,168], insideArm: [45,48], inseam: [69,74] }, Tall: { height: [168,175], insideArm: [48,51], inseam: [74,79] }, 'Extra Tall': { height: [175,185], insideArm: [51,54], inseam: [79,84] } };
      const LM = { Petite: { height: [150,170], insideArm: [46,49], inseam: [69,74] }, Regular: { height: [170,183], insideArm: [49,52], inseam: [75,80] }, Tall: { height: [183,195], insideArm: [52,55], inseam: [81,86] }, 'Extra Tall': { height: [195,205], insideArm: [55,58], inseam: [87,92] } };
      function suit(G, U, Lx, len) {
        const sizes = chart(L11, Object.assign({}, G, { ubend: U[len] }));
        sizes.forEach(s => { for (const k in Lx[len]) s.values[k] = Lx[len][k]; });
        return sizes;
      }
      const garments = [];
      ['Regular','Petite','Tall','Extra Tall'].forEach(len => garments.push({ name: "Catsuit · women's · " + len, sizes: suit(W, UW, LW, len) }));
      ['Regular','Petite','Tall','Extra Tall'].forEach(len => garments.push({ name: "Catsuit · men's · " + len, sizes: suit(M, UM, LM, len) }));
      garments.push({ name: 'Stockings · unisex', sizes: chart(L11, { thigh: [[43,45],[46,48],[49,51],[52,54],[55,57],[58,60],[61,63],[64,66],[67,69],[70,72],[73,75]] }) });
      garments.push({ name: 'Stocking feet', sizes: chart(['Regular foot','Long foot','Extra long foot'], { foot: [[22.5,25.5],[26,29],[28,31]] }) });
      return { id: 'libidex', name: 'Libidex', url: 'https://www.libidex.com', tol: 3,
        note: 'Body measurements. Pick your length (Petite to Extra Tall) for U-bend, arm and leg. 5XL and 6XL cost 15% more.',
        garments,
        images: [
          { id: 'lbx-guide', kind: 'guide', src: './assets/libidex/measuring-guide.png' },
          { id: 'lbx-girth', kind: 'chart', src: './assets/libidex/chart-girth.png' },
          { id: 'lbx-nbt', kind: 'chart', src: './assets/libidex/chart-neck-bicep-thigh.png' },
          { id: 'lbx-len', kind: 'chart', src: './assets/libidex/chart-lengths-ubend.png' },
          { id: 'lbx-socks', kind: 'chart', src: './assets/libidex/chart-socks-feet.png' },
          { id: 'lbx-stock', kind: 'chart', src: './assets/libidex/chart-stockings.png' }
        ] };
    })(),
    { id: 'kinkfox', name: 'Kinkfox', url: 'https://kinkfox.com/size-chart/', tol: 3,
      note: 'Body measurements. Made to measure adds about 2 weeks: fill in their size chart and upload it with the order.',
      garments: [
        { name: "Catsuit · men's (standard)", sizes: chart(S6, {
          height: [[160,164],[164,168],[168,172],[172,176],[176,180],[180,184]],
          head: [56,57,59,61,63,65],
          neck: [36,38,40,42,44,46],
          chest: [[90,94],[94,98],[98,102],[102,106],[106,110],[110,114]],
          waist: [[72,76],[76,80],[80,84],[84,88],[88,92],[92,96]],
          hips: [[92,96],[96,100],[100,104],[104,108],[108,112],[112,116]],
          upperArm: [29,31,33,35,37,39],
          elbow: [24,26,28,30,32,34],
          wrist: [16,17,18,19,20,21],
          torso: [146,150,154,158,162,166],
          thigh: [54,56,58,60,62,64],
          knee: [36,38,40,42,44,46],
          calf: [34,36,38,40,42,44],
          ankle: [21,22,23,24,25,26],
          foot: [25,25.8,26.6,27.4,28.2,29],
          inseam: [66,68,70,72,74,76],
          armLength: [53,55,57,59,61,63] }) }
      ],
      images: [{ id: 'kfx-male', kind: 'chart', src: './assets/kinkfox/chart-male-standard.png' }],
      m2mForm: [['chest','Chest'],['underbust','Under bust'],['waist','Waist'],['waistHip','Between waist and hip'],['hips','Hip'],['thigh','Thigh just below the crotch'],['knee','Knee'],['calf','Calf circle'],['ankle','Ankle'],['armpit','Around the armpit'],['upperArm','Bicep'],['elbow','Elbow'],['forearm','Forearm'],['wrist','Wrist'],['armLength','Arm length'],['neck','Neck'],['inseam','Leg length (inseam)'],['waistAnkle','Waist to ankle (outside)'],['torso','Torso length (one circle)'],['shoulder','Shoulder width'],['head','Forehead'],['height','Total body height'],['shoe','Shoe size']] },
    { id: 'latexforever', name: 'Latex Forever', url: 'https://latexforever.com/pages/about-sizing', tol: 3, garments: [], m2mOnly: true,
      note: 'Recommends made-to-measure, at no extra cost. Measurements are entered on the product page.' },
    { id: 'latexartisan', name: 'Latexartisan', url: 'https://www.latexartisan.com', tol: 3, garments: [], m2mOnly: true,
      note: 'Custom orders use a measurement form sent by email. Send your made-to-measure sheet.' }
  ];
  const KF = 'Shared Kinkfox order with Jasper and Kevin: €529.87 incl. €44.66 shipping, paid by PayPal.';
  window.FITLOG_IMPORTS = [
    { id: 'kinkfox-2026-10', profiles: [
      { name: 'Kevin', session: { date: '2026-10-18', values: { chest: 87, underbust: 82, waist: 75.5, waistHip: 83, hips: 92.5, thigh: 54, knee: 37.5, calf: 34.5, ankle: 22.5, armpit: 42.5, upperArm: 27, elbow: 25, forearm: 26.5, wrist: 17, armLength: 59, neck: 38, inseam: 74.5, waistAnkle: 103, torso: 162, shoulder: 42, head: 58.5, height: 181, shoe: 42.5 } },
        orders: [
          { brandId: 'kinkfox', item: "Alpha Pup Latex Suit · men's", date: '2026-10-18', price: '93.79', colour: 'Black, yellow trim', notes: 'Back zip to waist + 2-way bum zip. No scarf, arm or wrist bands. Dry powder finish. ' + KF },
          { brandId: 'kinkfox', item: "Black Red Stripe Latex Catsuit · men's", date: '2026-10-18', price: '120.59', colour: 'Black, white trim', notes: 'Shoulder zips + 2-way bum zip. No gloves or socks. Dry powder finish. ' + KF }
        ] },
      { name: 'Jasper', orders: [
          { brandId: 'kinkfox', item: "Alpha Pup Latex Suit · men's", date: '2026-10-18', price: '93.79', colour: 'Black, orange trim', notes: 'Back zip to waist + 2-way bum zip. No scarf, arm or wrist bands. Dry powder finish. ' + KF },
          { brandId: 'kinkfox', item: "Latex Alpha Husky Suit · men's", date: '2026-10-18', price: '177.04', colour: 'Black, white trim', notes: 'Shoulder entry zip + 2-way crotch zip. Separate black gloves and socks. Dry powder finish. ' + KF }
        ] }
    ] }
  ];
})();
