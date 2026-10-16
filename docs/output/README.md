# Guiones exportados

En una representación, usar **Exportar guion Fountain**. La aplicación guarda aquí el guion de todo el registro público confirmado hasta el commit elegido y ofrece su descarga. Exportar no llama al modelo.

Los archivos `.fountain` usan formato de guion: portada, encabezados de escena, personajes en mayúsculas, diálogos y acciones confirmadas. Fountain se puede leer como texto o abrir con un editor de guiones compatible. La nota inicial identifica representación, configuración y corte. No incluye pensamientos, memorias privadas ni instrucciones del Director. Una frase dicha no se transforma en una acción cumplida.

Cada resultado conserva su nombre, corte y hash. Otra exportación no sobrescribe un contenido diferente. Si se exporta antes del final, el guion contiene sólo lo ocurrido hasta ese corte; no completa desenlaces ni diálogos futuros. Las voces en off publicadas se distinguen del habla de los personajes.

Estos archivos viajan por Git si se agregan al commit. No restauran las sesiones Pi, memorias SQLite ni el journal privado de una representación.

- [CONTROL: el sello extraviado](control-el-sello-extraviado-6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f-c16-70285ec80d4db743.fountain): ensayo breve cerrado, seis parlamentos y acciones confirmadas; [contexto y límites](../representaciones/el-sello-extraviado.md).
- [CONTROL: el maletín bajo custodia](control-el-maletin-bajo-custodia-86456df9-4e17-40dd-bc3c-b72b7ab89098-c13-0489d9c440e3db24.fountain): entrega voluntaria, traslado entre salas y final abierto; [evidencia y límites](../representaciones/el-maletin-bajo-custodia.md).
- [CONTROL: entrega sin recibo](control-entrega-sin-recibo-1c5d4e41-8dcd-486e-85ca-672ce42747ca-c16-16100fcae30df154.fountain): depósito, regreso, aviso y reconocimiento, seis parlamentos y un gesto; [evidencia y límites](../representaciones/entrega-sin-recibo.md).
