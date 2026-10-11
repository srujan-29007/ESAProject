const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TAGS = [
  { rfidUid: 'TAG_001', name: 'Scalpel' },
  { rfidUid: 'TAG_002', name: 'Tissue Forceps' },
  { rfidUid: 'TAG_003', name: 'Surgical Scissors' },
  { rfidUid: 'E6A94106', name: 'Mayo Scissors' },
  { rfidUid: '5B677B05', name: 'FORCEPS' },
  { rfidUid: '95F99D04', name: 'Scalpel Handle' },
  { rfidUid: '6A33C162', name: 'Towel Clamps' },
];

async function main() {
  console.log('Clearing old data...');
  await prisma.scan.deleteMany();
  await prisma.tag.deleteMany();

  console.log('Seeding tags...');
  for (const t of TAGS) {
    await prisma.tag.create({ data: t });
  }

  console.log(`Seeded ${TAGS.length} tags.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
