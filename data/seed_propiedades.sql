-- seed_propiedades.sql — 20 propiedades sintéticas de Bariloche (precios de mercado creíbles, USD).
-- Inmobiliaria Demo (FICTICIA). url_ficha apunta a un dominio de ejemplo, no existe.
INSERT INTO propiedades
  (codigo, titulo, operacion, tipo, zona, ambientes, dormitorios, m2_cubiertos, precio_usd, unidad_precio, expensas_usd, direccion_aprox, descripcion, url_ficha, destacada, activa)
VALUES
-- ===== VENTA: departamentos =====
('LCB-001','Monoambiente a estrenar en el Centro','venta','departamento','Centro',1,0,32,78000,'venta_total',45,'Mitre al 300','Monoambiente luminoso, ideal renta temporaria, a pasos del Centro Cívico.','https://inmobiliaria-demo.example/propiedades/LCB-001',FALSE,TRUE),
('LCB-002','Departamento 2 ambientes en Belgrano','venta','departamento','Belgrano',2,1,48,125000,'venta_total',60,'Elflein al 200','Dos ambientes con balcón, cocina integrada, apto crédito.','https://inmobiliaria-demo.example/propiedades/LCB-002',FALSE,TRUE),
('LCB-003','3 ambientes con vista al lago','venta','departamento','Centro',3,2,72,189000,'venta_total',85,'Av. Bustillo Km 0.5','Vista al Nahuel Huapi, dos dormitorios, cochera cubierta.','https://inmobiliaria-demo.example/propiedades/LCB-003',TRUE,TRUE),
('LCB-004','2 ambientes en Ñireco','venta','departamento','Ñireco',2,1,45,98000,'venta_total',40,'Onelli al 1100','Cómodo 2 ambientes, zona tranquila, cerca de comercios.','https://inmobiliaria-demo.example/propiedades/LCB-004',FALSE,TRUE),
-- ===== VENTA: casas =====
('LCB-005','Casa 3 dormitorios en Melipal','venta','casa','Melipal',4,3,140,295000,'venta_total',NULL,'Los Notros al 500','Casa familiar con jardín, quincho y cochera doble.','https://inmobiliaria-demo.example/propiedades/LCB-005',TRUE,TRUE),
('LCB-006','Casa 4 dorm con vista en Las Victorias','venta','casa','Las Victorias',5,4,210,480000,'venta_total',NULL,'Cerro Otto ladera','Vista panorámica al lago, amplios ventanales, 4 dormitorios en suite.','https://inmobiliaria-demo.example/propiedades/LCB-006',TRUE,TRUE),
('LCB-007','Casa 3 dorm en Jardín Botánico','venta','casa','Jardín Botánico',4,3,160,340000,'venta_total',NULL,'Los Radales al 800','Diseño de montaña, living con hogar a leña, lote parquizado.','https://inmobiliaria-demo.example/propiedades/LCB-007',FALSE,TRUE),
('LCB-008','Casa 2 dorm en San Francisco (Km 3)','venta','casa','Km 3 - San Francisco',3,2,95,175000,'venta_total',NULL,'Av. de los Pioneros Km 3','Casa en dos plantas, ideal primera vivienda, cerca del centro.','https://inmobiliaria-demo.example/propiedades/LCB-008',FALSE,TRUE),
('LCB-009','Casa premium en Arelauquen Golf','venta','casa','Arelauquen',6,4,320,690000,'venta_total',NULL,'Arelauquen Golf & Country','Propiedad premium dentro del barrio cerrado, acceso al golf y al lago Gutiérrez.','https://inmobiliaria-demo.example/propiedades/LCB-009',TRUE,TRUE),
('LCB-010','Casa 3 dorm en Villa Los Coihues (Km 8)','venta','casa','Km 8 - Villa Los Coihues',4,3,150,265000,'venta_total',NULL,'Lago Gutiérrez s/n','Rodeada de bosque, a metros del lago Gutiérrez, muy luminosa.','https://inmobiliaria-demo.example/propiedades/LCB-010',FALSE,TRUE),
-- ===== VENTA: cabañas =====
('LCB-011','Cabaña en el bosque Km 8','venta','cabaña','Km 8',3,2,85,198000,'venta_total',NULL,'Av. Bustillo Km 8','Cabaña de troncos, entorno natural, apta renta turística.','https://inmobiliaria-demo.example/propiedades/LCB-011',FALSE,TRUE),
('LCB-012','Complejo de 2 cabañas en Dina Huapi','venta','cabaña','Dina Huapi',6,4,180,310000,'venta_total',NULL,'Dina Huapi acceso','Complejo en funcionamiento, dos unidades, excelente renta.','https://inmobiliaria-demo.example/propiedades/LCB-012',TRUE,TRUE),
-- ===== VENTA: terrenos =====
('LCB-013','Terreno 800 m2 en Dina Huapi','venta','terreno','Dina Huapi',0,0,0,52000,'venta_total',NULL,'Dina Huapi loteo','Lote con servicios, listo para construir, zona en crecimiento.','https://inmobiliaria-demo.example/propiedades/LCB-013',FALSE,TRUE),
('LCB-014','Terreno con vista en Península San Pedro','venta','terreno','Península San Pedro',0,0,0,95000,'venta_total',NULL,'Península San Pedro','1200 m2 con vista al lago, entre bosque nativo.','https://inmobiliaria-demo.example/propiedades/LCB-014',FALSE,TRUE),
('LCB-015','Terreno 600 m2 en El Cóndor','venta','terreno','El Cóndor',0,0,0,38000,'venta_total',NULL,'Barrio El Cóndor','Lote en barrio residencial, buena orientación.','https://inmobiliaria-demo.example/propiedades/LCB-015',FALSE,TRUE),
-- ===== ALQUILER (USD mensual) =====
('LCB-016','Monoambiente en alquiler, Centro','alquiler','departamento','Centro',1,0,32,420,'alquiler_mensual',45,'Quaglia al 200','Monoambiente amoblado, contrato anual, a metros del centro.','https://inmobiliaria-demo.example/propiedades/LCB-016',FALSE,TRUE),
('LCB-017','2 ambientes en alquiler, Belgrano','alquiler','departamento','Belgrano',2,1,50,560,'alquiler_mensual',60,'Gallardo al 900','Dos ambientes luminoso, contrato anual, apto mascota.','https://inmobiliaria-demo.example/propiedades/LCB-017',FALSE,TRUE),
('LCB-018','Casa 3 dorm en alquiler, Melipal','alquiler','casa','Melipal',4,3,140,1100,'alquiler_mensual',NULL,'Los Ñires al 400','Casa amplia con jardín, contrato anual, excelente ubicación.','https://inmobiliaria-demo.example/propiedades/LCB-018',TRUE,TRUE),
('LCB-019','3 ambientes en alquiler, Centro','alquiler','departamento','Centro',3,2,70,780,'alquiler_mensual',85,'Moreno al 100','Tres ambientes con cochera, contrato anual.','https://inmobiliaria-demo.example/propiedades/LCB-019',FALSE,TRUE),
('LCB-020','Cabaña 2 dorm, alquiler temporario Km 8','alquiler','cabaña','Km 8',3,2,80,1400,'alquiler_mensual',NULL,'Av. Bustillo Km 8.5','Cabaña equipada para alquiler temporario, vista al bosque.','https://inmobiliaria-demo.example/propiedades/LCB-020',FALSE,TRUE);
