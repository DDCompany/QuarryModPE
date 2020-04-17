function findNearest(x, y, z, id, func) {
    for (let index in directions) {
        let dir = directions[index];
        let tile = World.getTileEntity(x + dir[0], y + dir[1], z + dir[2]);

        if (tile && World.getBlockID(x + dir[0], y + dir[1], z + dir[2]) === id) {
            if (func(tile))
                return;
        }
    }
}

TileEntity.registerPrototype(BlockID.quarryCasing, {
    init: function () {
        let self = this;
        findNearest(this.x, this.y, this.z, BlockID.quarry, function (tile) {
            self.tile = tile;
        });

        if (this.tile) {
            this.tile.addCasing(this);
        }
    },

    energyReceive: function (type, amount) {
        if (!this.tile)
            return 0;

        amount = amount / EnergyTypeRegistry.getValueRatio(type, "Eu");
        const add = Math.min(amount, this.tile.getEnergyStorage() - this.tile.data.energy);
        this.tile.data.energy += add;
        return add;
    },

    click: function () {
        if (this.tile)
            this.tile.container.openAs(gui);

        return false;
    },

    destroy: function () {
        this.container = new UI.Container();
        if (this.tile)
            this.tile.removeCasing(this);
    }
});

TileEntity.registerPrototype(BlockID.quarry, {
    defaultValues: {
        // Количество энергии в TE
        energy: 0,
        // Количество опыта
        exp: 0,
        // Модификатор радиуса копания
        territoryModifier: 1,
        //Координаты, на который копает карьер
        digY: 0,
        digX: 0,
        digZ: 0,
        // Карьер завершил свою работы?
        complete: false,
        // Включён белый список?
        whitelist: false,
        // Если true в tick произойдёт обновление состояния переключателя
        stateFlag: false,
        drop: [],
        progress: 0,
        progressMax: 0
    },
    casings: [],
    isValid: false,

    init: function () {
        this.casings = [];
    },

    created: function () {
        this.data.digY = this.y - 3;
        this.data.digX = this.x - 16 * this.data.territoryModifier;
        this.data.digZ = this.z - 16 * this.data.territoryModifier;

        findNearest(this.x, this.y, this.z, BlockID.quarry, function (tile) {
            this.addCasing(tile);
        });
    },

    getGuiScreen: function () {
        this.data.stateFlag = true;
        return gui;
    },

    /**
     * Добавление дропа в буффер
     * @param item
     */
    addItemToStorage: function (item) {
        for (let i = 0; i < 15; i++) {
            let slot = this.container.getSlot("slot" + i);

            if (!slot.id) {
                slot.id = item[0];
                slot.count = item[1];
                slot.data = item[2];

                return null;
            } else if (slot.id === item[0] && slot.data === item[2] && Item.getMaxStack(slot.id) !== slot.count) {
                let count = Math.min(Item.getMaxStack(slot.id) - slot.count, item[1]);
                slot.count += count;

                if (count < item[1]) {
                    return [item[0], item[1] - count, item[2]];
                } else return null;
            }
        }

        return item;
    },

    /**
     * Применение модификаторов апгрейдов и линз
     */
    applyUpgrades: function () {
        this.data.territoryModifier = 1;
        this.smelt = false;

        for (let i = 0; i < 2; i++) {
            let slotUpgrade = this.container.getSlot("slotUpgrade" + i);
            let slotLens = this.container.getSlot("slotLens" + i);

            if (slotUpgrade.id === ItemID.quarryUpgradeTerritory) {
                this.data.territoryModifier *= 2;
            }

            if (slotLens.id === ItemID.quarryLensSmelt) {
                this.smelt = true;
            }
        }
    },

    /**
     * @param slotTool
     * @returns boolean Истина если предметом slotTool можно добывать блоки с материалом stone
     */
    isCorrectTool: function (slotTool) {
        if (!slotTool.id)
            return false;

        const toolData = ToolAPI.getToolData(slotTool.id);
        const chargeData = ChargeItemRegistry.getItemData(slotTool.id);
        if (chargeData) {
            const energyPerUse = toolData.toolMaterial.energyPerUse;
            return chargeData.energy === "Eu" || chargeData.energy === "RF"
                && energyPerUse
                && ChargeItemRegistry.getEnergyStored(slotTool, chargeData.energy) >= energyPerUse
        }

        return toolData && toolData.blockMaterials && toolData.blockMaterials["stone"];
    },

    /**
     * Тратим прочность инструмента
     * @param slotTool
     */
    damageTool: function (slotTool) {
        const changeData = ChargeItemRegistry.getItemData(slotTool.id);
        if (changeData) {
            let consume = ToolAPI.getToolData(slotTool.id).toolMaterial.energyPerUse;
            const energy = Math.min(this.data.energy, consume);

            if (energy > 0) {
                consume -= energy;
                this.data.energy -= energy;
            }

            if (consume > 0)
                ChargeItemRegistry.setEnergyStored(slotTool, ChargeItemRegistry.getEnergyStored(slotTool) - consume);
        } else {
            slotTool.data++;
            if (slotTool.data >= Item.getMaxDamage(slotTool.id)) {
                slotTool.id = 0;
                slotTool.data = 0;
                slotTool.count = 0;
                slotTool.extra = 0;
            }
        }
    },

    addCasing: function (casing) {
        this.casings.push(casing);
        casing.tile = this;
        casing.container = this.container;
        this.isValid = this.casings.length === 6;
        alert(this.casings.length + " " + this.isValid);
    },

    removeCasing: function (casing) {
        this.casings.splice(this.casings.indexOf(casing), 1);
        this.isValid = this.casings.length === 6;
        alert("destroy " + this.casings.length);
    },

    /**
     * Обновление списка блоков в Белом/Черном списке
     */
    refreshList: function () {
        this.data.list = {};
        for (let i = 0; i < 6; i++) {
            let slot = this.container.getSlot("slotList" + i);

            if (slot.id)
                this.data.list[slot.id + ":" + slot.data] = true;
        }
    },

    isOnTheList: function (block) {
        if (this.data.whitelist) {
            return this.data.list[block.id + ":" + block.data];
        } else return !this.data.list[block.id + ":" + block.data];
    },

    tick: function () {
        const content = this.container.getGuiContent();
        let slotTool = this.container.getSlot("slotTool");
        let correctTool = this.isCorrectTool(slotTool);

        if (World.getThreadTime() % 60 === 0) {
            this.refreshList(); //TODO: refactor
            this.applyUpgrades();
        }

        let drop = this.data.drop;
        if (drop && drop.length > 0) {
            const items = [];
            for (let i in drop) {
                let item = drop[i];
                item = this.addItemToStorage(item);
                if (item) {
                    items.push(item);
                }
            }

            drop = this.data.drop = items;
        } else if (World.getThreadTime() % 20 === 0 && this.isValid && !this.data.complete && (slotTool.id === 0 ? this.data.energy > ENERGY_PER_DESTROY : correctTool)) {
            if (this.data.progress) {
                if (++this.data.progress > this.data.progressMax) {
                    this.data.progress = 0;
                    let coords = {
                        x: this.data.digX,
                        y: this.data.digY,
                        z: this.data.digZ
                    };
                    let block = World.getBlock(this.data.digX, this.data.digY, this.data.digZ);
                    let dropped = Block.getBlockDropViaItem(block, correctTool ? slotTool : {
                        id: 278,
                        data: 0
                    }, coords);
                    let entities = Entity.getAllInRange(coords, 2, 69);

                    if (this.smelt) {
                        if (dropped && dropped.length > 0) {
                            for (let i in dropped) {
                                const item = dropped[i];
                                const smelted = Recipes.getFurnaceRecipeResult(item[0], item[2]);

                                if (smelted)
                                    dropped[i] = [smelted.id, item[1], smelted.data];
                            }
                        }
                    }
                    this.data.drop = dropped;

                    if (correctTool)
                        this.damageTool(slotTool);
                    else this.data.energy -= ENERGY_PER_DESTROY;

                    for (let index in entities) {
                        if (this.data.exp >= 1000)
                            break;

                        this.data.exp = Math.min(1000, this.data.exp + 2);
                        Entity.remove(entities[index]);
                    }

                    World.setBlock(this.data.digX, this.data.digY, this.data.digZ, 3);
                }
            } else if (this.data.energy >= ENERGY_PER_SCAN) {
                let range = 16 * this.data.territoryModifier;

                //Increase dig position
                if (++this.data.digX > this.x + range) {
                    this.data.digX = this.x - range;
                    if (++this.data.digZ > this.z + range) {
                        this.data.digZ = this.z - range;
                        if (--this.data.digY < 1) {
                            this.data.complete = true;
                        }
                    }
                }
                //Consume energy
                this.data.energy -= ENERGY_PER_SCAN;

                let block = World.getBlock(this.data.digX, this.data.digY, this.data.digZ);
                if (block.id > 0) {

                    if (ToolAPI.getBlockMaterial(block.id).name === "stone" && this.isOnTheList(block)) {
                        const coords = {
                            x: this.data.digX,
                            y: this.data.digY,
                            z: this.data.digZ
                        };
                        this.data.progress = 1;
                        this.data.progressMax = Math.round(ToolAPI.getDestroyTimeViaTool(block, slotTool || {
                            id: 278,
                            data: 0
                        }, coords, false) * 3);
                    }
                }
            }
        }

        if (content) {
            if (this.data.stateFlag)
                this.container.setBinding("switch", "state", this.data.whitelist);

            if (slotTool.id !== 0 && !correctTool) {
                content.elements["text"].text = "Incorrect tool";
            } else if (drop && drop.length > 0) {
                content.elements["text"].text = "Not enough space";
            } else if (this.isValid) {
                content.elements["text"].text = "X:" + this.data.digX + " Y:" + this.data.digY + " Z:" + this.data.digZ;
            } else {
                content.elements["text"].text = "Incorrect structure";
            }

            content.elements["textExp"].text = "Exp: " + this.data.exp;
            content.elements["textRange"].text = "Range: " + 16 * this.data.territoryModifier;

            this.container.setScale("energyScale", this.data.energy / this.getEnergyStorage());
            this.container.setScale("expScale", this.data.exp / 1000);
        }
    },

    getEnergyStorage: function () {
        return 50000;
    },

    destroy: function () {
        for (let i in this.casings) {
            this.casings[i].tile = null;
        }
    }
});

StorageInterface.createInterface(BlockID.quarryCasing, {
    slots: {
        "slot^0-14": {
            output: true
        },
        "slotTool": {
            input: true
        }
    }
});

for (let i in energyTypes) {
    EnergyTileRegistry.addEnergyTypeForId(BlockID.quarryCasing, energyTypes[i]);
}